// Leitura de texto SEM eco no terminal (senhas e chaves). Mantém o que sobra entre perguntas, então colar
// "senha⏎confirmação⏎" de uma vez funciona; entende Backspace e caracteres fora do ASCII (acentos, emoji).
let started = false, line = "";
const lines = [];
let waiter = null;

function onData(chunk) {
  for (const c of chunk) {
    if (c === "\u0003") { process.stdout.write("\n"); process.exit(130); } // Ctrl+C
    if (c === "\r" || c === "\n") { lines.push(line); line = ""; }
    else if (c === "\u007f" || c === "\b") line = [...line].slice(0, -1).join("");
    else line += c;
    if (waiter && lines.length) { const w = waiter; waiter = null; w(lines.shift()); }
  }
}

export function askHidden(prompt) {
  if (!process.stdin.isTTY) { console.error("Rode num terminal interativo (o valor não pode vir por pipe)."); process.exit(1); }
  process.stdout.write(prompt);
  if (!started) {
    started = true;
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
  }
  return new Promise((resolve) => {
    const done = (v) => { process.stdout.write("\n"); resolve(v); };
    if (lines.length) return done(lines.shift());
    waiter = done;
  });
}

export function closePrompt() {
  if (!started) return;
  process.stdin.off("data", onData);
  process.stdin.setRawMode?.(false);
  process.stdin.pause();
}
