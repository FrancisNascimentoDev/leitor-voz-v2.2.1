// Extrai o texto de um PDF com o pdf.js (Mozilla) — roda num documento invisível da extensão
import * as pdfjsLib from "./lib/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdf.worker.min.mjs");

chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
  if (msg?.alvo !== "offscreen" || msg.tipo !== "pdf") return;
  extrairTexto(msg.url)
    .then((texto) => responder({ texto }))
    .catch((e) => responder({ erro: String(e?.message || e) }));
  return true;   // resposta assíncrona
});

async function extrairTexto(url) {
  const resposta = await fetch(url);
  if (!resposta.ok) throw new Error("download falhou, HTTP " + resposta.status);
  const dados = new Uint8Array(await resposta.arrayBuffer());

  // isEvalSupported: false → respeita a política de segurança das extensões (sem eval)
  const pdf = await pdfjsLib.getDocument({ data: dados, isEvalSupported: false }).promise;
  const paginas = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const pagina = await pdf.getPage(n);
    const conteudo = await pagina.getTextContent();
    let texto = "";
    for (const item of conteudo.items) {
      if (!("str" in item)) continue;
      texto += item.str + (item.hasEOL ? "\n" : "");
    }
    paginas.push(texto);
  }
  // juntarLinhasPdf vem do frases.js
  return juntarLinhasPdf(paginas.join("\n"));
}
