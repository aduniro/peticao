# Azure bounded idle deallocation

Fixed target: /subscriptions/57298c3f-7cf2-4dbe-9884-c7bafdff4478/resourceGroups/peticao-dev-eastus/providers/Microsoft.Compute/virtualMachines/peticao-azure-dev-01. No create/start/delete, no controller, no new credentials. Existing approved10-minute idle policy only. Root and Infra explicitly report no current/immediate consumer.

Before action: actual immutable source and Root ACK, own manifest-bound deploy reservation;21 samples30seconds apart spanning at least600seconds, complete metadata and no workloads/containers/other interactive sessions/jobs; unknown userspace process refused. Observer ancestors, known OS services and Azure agent are explicitly distinguished. Samples must end within300seconds of action preparation. Fresh SSH occupancy/export/finished-build check and fence are revalidated immediately before one deallocate request.

The completed runtime archive is475893760bytes, SHA2567e204c3666e8c44258cb5b10edab42066951a5fdc143781d3dd48779475a5557, on root ext4 under /mnt/apps/peticao-final/.runtime/azure-qualification-c472-20261114-attempt1/exports/build-1/runtime.tar. Azure managed OS disk identity must exist, ephemeral OS settings must be absent. Selected persistent VM/disk/network/public-IP/tag configuration must remain equal after deallocation. This does not claim temporary NVMe persistence or zero disk/IP charges.

Metadata observation reads process names/cwd/stat, not argv/environment. No private key content, OAuth/history, signer data or app database is inspected. SSH consumes the existing key normally.31-second or shorter finite metadata commands; one600second script observation, not LLM polling.

Evidence window:30second snapshots, not continuous process tracing; owner-coordinator declarations supplement observed idleness. If already deallocated, leave unchanged without starting. Any contradiction stops this front. Transport/API uncertainty never retries the deallocation; record and inspect state separately.
