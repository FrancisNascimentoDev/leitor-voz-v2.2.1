// Roda em cada página/quadro e só guarda ONDE você clicou ou selecionou por último.
// Não lê, não envia e não altera nada: é usado pelo "Ler daqui em diante".
(() => {
  const guardarClique = (e) => {
    try {
      window.__leitorClique = {
        x: e.clientX,
        y: e.clientY,
        sx: window.scrollX,
        sy: window.scrollY,
        alvo: e.composedPath()[0],   // elemento real, mesmo dentro de Shadow DOM
        t: Date.now()
      };
    } catch (erro) { /* ignora */ }
  };
  window.addEventListener("pointerdown", guardarClique, true);
  window.addEventListener("contextmenu", guardarClique, true);
  document.addEventListener("selectionchange", () => { window.__leitorSelT = Date.now(); });
})();
