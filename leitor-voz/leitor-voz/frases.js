// ===== Divide o texto em frases curtas (usado pelo background e pelos testes) =====
// Cada quebra de linha vira limite de frase (títulos não grudam no parágrafo seguinte).
// "1.5" e "www.site.com" não são cortados porque o corte exige espaço depois da pontuação.
function dividirFrases(texto, max = 250) {
  const frases = [];
  const temConteudo = (s) => /[\p{L}\p{N}]/u.test(s);

  for (const linha of String(texto || "").split(/\n+/)) {
    const limpa = linha.replace(/\s+/g, " ").trim();
    if (!temConteudo(limpa)) continue;

    for (const frase of limpa.split(/(?<=[.!?…;])\s+(?=\S)/)) {
      if (!temConteudo(frase)) continue;
      if (frase.length <= max) { frases.push(frase); continue; }

      // Frase muito longa: corta em vírgulas e, se precisar, em palavras
      let atual = "";
      for (const pedaco of frase.split(/(?<=,)\s+/)) {
        if (pedaco.length > max) {
          for (const palavra of pedaco.split(" ")) {
            if ((atual + " " + palavra).trim().length > max && atual) { frases.push(atual.trim()); atual = ""; }
            atual += " " + palavra;
          }
          continue;
        }
        if ((atual + " " + pedaco).trim().length > max && atual) { frases.push(atual.trim()); atual = ""; }
        atual += " " + pedaco;
      }
      if (atual.trim()) frases.push(atual.trim());
    }
  }
  return frases;
}

// ===== PDF: o pdf.js entrega o texto linha por linha (como está impresso). =====
// Aqui juntamos as linhas de volta em parágrafos, para a voz não pausar no meio da frase.
function juntarLinhasPdf(texto) {
  let saida = "";
  let anterior = "";   // linha impressa anterior
  for (const bruta of String(texto || "").split("\n")) {
    const linha = bruta.replace(/\s+/g, " ").trim();
    if (!linha) continue;
    if (!saida) { saida = anterior = linha; continue; }

    const fimDeFrase = /[.!?…:;]["'”)\]]?$/.test(anterior);
    const pareceTitulo = anterior.length < 60 && /^[\p{Lu}\d]/u.test(linha);

    if (/\p{L}-$/u.test(anterior) && /^\p{Ll}/u.test(linha)) {
      saida = saida.slice(0, -1) + linha;              // palavra hifenizada no fim da linha
    } else if (fimDeFrase || pareceTitulo) {
      saida += "\n" + linha;                           // fim de frase ou título: novo parágrafo
    } else {
      saida += " " + linha;                            // mesma frase continuando
    }
    anterior = linha;
  }
  return saida;
}

if (typeof module !== "undefined") module.exports = { dividirFrases, juntarLinhasPdf };
