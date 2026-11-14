#!/usr/bin/env python3
"""Offline policy checks only; does not run bootstrap or contact Azure/network."""
import ipaddress
import json
from pathlib import Path
import re
import subprocess
import unittest


ROOT = Path(__file__).resolve().parent
TEMPLATE = json.loads((ROOT / "main.json").read_text())
BOOTSTRAP = (ROOT / "bootstrap.sh").read_text()
APPROVED_TAGS = {
    "Project": "peticao",
    "Operation": "APOIO-AZURE-20261114",
    "Coordinator": "infra",
    "ManagedBy": "apoio",
}


def walk(value):
    if isinstance(value, dict):
        for key, item in value.items():
            yield key, item
            yield from walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk(item)


def resource(kind):
    matches = [r for r in TEMPLATE["resources"] if r["type"] == kind]
    if len(matches) != 1:
        raise AssertionError(f"Expected exactly one {kind}, found {len(matches)}")
    return matches[0]


class TemplatePolicyTests(unittest.TestCase):
    def test_group_scope_inventory_and_fixed_names(self):
        self.assertTrue(TEMPLATE["$schema"].endswith("/2019-04-01/deploymentTemplate.json#"))
        self.assertEqual(TEMPLATE["metadata"]["deploymentScope"], "resourceGroup")
        self.assertEqual(TEMPLATE["metadata"]["targetSubscriptionId"],
                         "57298c3f-7cf2-4dbe-9884-c7bafdff4478")
        self.assertEqual(TEMPLATE["metadata"]["targetResourceGroup"], "peticao-dev-eastus")
        self.assertEqual(TEMPLATE["variables"]["location"], "eastus")
        expected = {
            "Microsoft.Network/networkSecurityGroups": "nsgName",
            "Microsoft.Network/virtualNetworks": "vnetName",
            "Microsoft.Network/publicIPAddresses": "publicIpName",
            "Microsoft.Network/networkInterfaces": "nicName",
            "Microsoft.Compute/virtualMachines": "vmName",
        }
        self.assertCountEqual([r["type"] for r in TEMPLATE["resources"]], expected)
        self.assertEqual(TEMPLATE["variables"]["tags"], APPROVED_TAGS)
        for kind, variable in expected.items():
            r = resource(kind)
            self.assertEqual(r["name"], f"[variables('{variable}')]")
            self.assertTrue(TEMPLATE["variables"][variable].startswith("peticao-azure-dev-01"))
            self.assertEqual(r["location"], "[variables('location')]")
            self.assertEqual(r["tags"], "[variables('tags')]")
            self.assertEqual(r["apiVersion"], "2024-07-01" if "Compute" in kind else "2024-05-01")
        self.assertFalse(any(key in {"scope", "subscriptionId", "resourceGroup", "resources"}
                             for r in TEMPLATE["resources"] for key in r))

    def test_only_runtime_public_key_parameter_and_safe_outputs(self):
        self.assertEqual(set(TEMPLATE["parameters"]), {"adminSshPublicKey"})
        p = TEMPLATE["parameters"]["adminSshPublicKey"]
        self.assertEqual(p["type"], "secureString")
        self.assertNotIn("defaultValue", p)
        self.assertEqual(set(TEMPLATE["outputs"]), {"vmId", "publicIP", "privateIP"})
        forbidden = {"customdata", "userdata", "adminpassword", "protectedsettings",
                     "diffdisksettings", "virtualmachineextensions"}
        for key, value in walk(TEMPLATE):
            self.assertNotIn(key.lower(), forbidden)
            if isinstance(value, str):
                self.assertNotRegex(value, r"-----BEGIN .*PRIVATE KEY-----|ssh-(rsa|ed25519) AAAA|tskey-")
        self.assertNotIn("adminSshPublicKey", json.dumps(TEMPLATE["outputs"]))

    def test_ssh_only_from_approved_cidr_and_no_outbound_changes(self):
        rules = resource("Microsoft.Network/networkSecurityGroups")["properties"]["securityRules"]
        self.assertEqual(len(rules), 2)
        allow, deny = sorted([r["properties"] for r in rules], key=lambda p: p["priority"])
        for rule in (allow, deny):
            self.assertEqual(rule["direction"], "Inbound")
            self.assertEqual(rule["protocol"], "Tcp")
            self.assertEqual(rule["destinationPortRange"], "22")
            self.assertEqual(rule["sourcePortRange"], "*")
            self.assertEqual(rule["destinationAddressPrefix"], "*")
        self.assertEqual((allow["access"], allow["priority"], allow["sourceAddressPrefix"]),
                         ("Allow", 100, "181.220.194.57/32"))
        self.assertEqual((deny["access"], deny["priority"], deny["sourceAddressPrefix"]),
                         ("Deny", 200, "*"))
        self.assertEqual(ipaddress.ip_network(allow["sourceAddressPrefix"]).num_addresses, 1)

    def test_network_and_dependencies(self):
        vnet = resource("Microsoft.Network/virtualNetworks")["properties"]
        self.assertEqual(vnet["addressSpace"]["addressPrefixes"], ["10.96.80.0/24"])
        self.assertEqual(len(vnet["subnets"]), 1)
        subnet = vnet["subnets"][0]
        self.assertEqual(subnet["properties"]["addressPrefix"], "10.96.80.0/26")
        self.assertTrue(ipaddress.ip_network("10.96.80.0/26").subnet_of(ipaddress.ip_network("10.96.80.0/24")))
        pip = resource("Microsoft.Network/publicIPAddresses")
        self.assertEqual(pip["sku"]["name"], "Standard")
        self.assertEqual(pip["properties"]["publicIPAllocationMethod"], "Static")
        self.assertEqual(pip["properties"]["publicIPAddressVersion"], "IPv4")
        nic = resource("Microsoft.Network/networkInterfaces")
        self.assertTrue(nic["properties"]["enableAcceleratedNetworking"])
        self.assertEqual(len(nic["dependsOn"]), 3)
        self.assertIn("networkSecurityGroups", nic["properties"]["networkSecurityGroup"]["id"])
        configs = nic["properties"]["ipConfigurations"]
        self.assertEqual(len(configs), 1)
        self.assertIn("virtualNetworks/subnets", configs[0]["properties"]["subnet"]["id"])
        self.assertIn("publicIPAddresses", configs[0]["properties"]["publicIPAddress"]["id"])

    def test_fixed_compute_image_security_and_persistent_storage(self):
        vm = resource("Microsoft.Compute/virtualMachines")["properties"]
        self.assertEqual(vm["hardwareProfile"]["vmSize"], "Standard_E8ads_v7")
        storage = vm["storageProfile"]
        self.assertEqual(storage["diskControllerType"], "NVMe")
        self.assertEqual(storage["imageReference"], {
            "publisher": "Debian", "offer": "debian-13", "sku": "13-gen2", "version": "0.20261111.2659"
        })
        self.assertEqual(storage["dataDisks"], [])
        disk = storage["osDisk"]
        self.assertEqual((disk["diskSizeGB"], disk["managedDisk"]["storageAccountType"]),
                         (128, "StandardSSD_LRS"))
        self.assertEqual((disk["createOption"], disk["osType"], disk["deleteOption"]),
                         ("FromImage", "Linux", "Detach"))
        osprofile = vm["osProfile"]
        self.assertEqual(osprofile["adminUsername"], "builder")
        self.assertTrue(osprofile["linuxConfiguration"]["disablePasswordAuthentication"])
        self.assertEqual(osprofile["linuxConfiguration"]["ssh"]["publicKeys"], [{
            "path": "/home/builder/.ssh/authorized_keys", "keyData": "[parameters('adminSshPublicKey')]"
        }])
        self.assertEqual(vm["securityProfile"], {
            "securityType": "TrustedLaunch", "uefiSettings": {"secureBootEnabled": True, "vTpmEnabled": True}
        })
        self.assertNotIn("storageUri", vm["diagnosticsProfile"]["bootDiagnostics"])


class BootstrapPolicyTests(unittest.TestCase):
    def test_bash_parses_without_execution(self):
        subprocess.run(["/bin/bash", "-n", str(ROOT / "bootstrap.sh")], check=True)

    def test_host_os_guards_and_noninteractive_packages(self):
        for token in ('hostname -s', 'peticao-azure-dev-01', '"${ID}" == debian',
                      '"${VERSION_ID}" == 13', 'dpkg --print-architecture', '== amd64',
                      'DEBIAN_FRONTEND=noninteractive', 'NEEDRESTART_MODE=l'):
            self.assertIn(token, BOOTSTRAP)
        for package in ("git", "gh", "git-lfs", "python3", "python3-venv", "curl",
                        "ca-certificates", "gnupg", "jq", "tailscale"):
            self.assertRegex(BOOTSTRAP, rf"\b{re.escape(package)}\b")
        urls = re.findall(r"https://[^\s]+", BOOTSTRAP)
        self.assertEqual(urls, [
            "https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg",
            "https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list",
        ])

    def test_no_enrollment_credentials_disks_or_service_reconfiguration(self):
        executable = "\n".join(line for line in BOOTSTRAP.splitlines() if not line.lstrip().startswith("#"))
        self.assertNotRegex(executable, r"tailscale\s+(up|login|set)|authkey|tskey-|password|PRIVATE KEY")
        self.assertNotRegex(executable, r"\b(ssh|sshd|ufw|iptables|nft|mount|umount|mkfs|fdisk|parted|wipefs|dd)\b")
        self.assertNotRegex(executable, r"/dev/(nvme|sd)|/etc/(ssh|fstab)|k3s|postgres|docker|kubectl")
        self.assertNotRegex(executable, r"apt-get\s+(upgrade|dist-upgrade|autoremove|remove|purge)")
        self.assertNotRegex(executable, r"\b(rm|reboot|shutdown)\b")

    def test_private_append_log_and_completion_after_install(self):
        self.assertIn("readonly LOG_FILE=/var/log/peticao-azure-bootstrap.log", BOOTSTRAP)
        self.assertIn("umask 077", BOOTSTRAP)
        self.assertIn('chmod 0600 -- "${LOG_FILE}"', BOOTSTRAP)
        self.assertIn('chown root:root -- "${LOG_FILE}"', BOOTSTRAP)
        self.assertIn('exec >>"${LOG_FILE}" 2>&1', BOOTSTRAP)
        self.assertIn("log retained:", BOOTSTRAP)
        self.assertGreater(BOOTSTRAP.index("PETICAO_AZURE_BOOTSTRAP_COMPLETE"),
                           BOOTSTRAP.index("--no-install-recommends tailscale"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
