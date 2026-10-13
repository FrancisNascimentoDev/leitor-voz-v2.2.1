// =====================================================================
//  Leitor em Voz Alta — motor (service worker)
//  Guarda a lista de frases, a frase atual e controla a voz (chrome.tts).
// =====================================================================
importScripts("frases.js");

const PADRAO = { rate: 1.0, pitch: 1.0, voiceName: "", destacar: true, rolar: true };

// Estado do player
const estado = {
  frases: [],
  indice: 0,
  status: "parado",   // parado | tocando | pausado | carregando
  titulo: "",
  versao: 0,          // muda quando um texto novo é carregado
  erro: "",
  fonte: null         // { tabId, frameId, texto } — de onde veio o texto (para destacar na página)
};
let sessao = 0;        // invalida callbacks de leituras antigas
let manterAcordado = null;

// ---------- Persistência (o service worker "dorme"; isso evita perder o texto) ----------
const pronto = chrome.storage.session.get("estado").then(({ estado: salvo }) => {
  if (salvo) Object.assign(estado, salvo, { status: salvo.frases?.length ? "pausado" : "parado" });
}).catch(() => {});

function salvar() {
  chrome.storage.session.set({ estado: { ...estado } }).catch(() => {});
}

function resumo() {
  const { indice, status, titulo, versao, erro } = estado;
  return { indice, status, titulo, versao, erro, total: estado.frases.length };
}

// Avisa o popup (se estiver aberto)
function notificar() {
  chrome.runtime.sendMessage({ tipo: "estado", estado: resumo() }).catch(() => {});
}

function mudar(campos) {
  Object.assign(estado, campos);
  notificar();
}

// ---------- Mantém o service worker ativo durante a leitura ----------
function iniciarKeepAlive() {
  pararKeepAlive();
  manterAcordado = setInterval(() => chrome.runtime.getPlatformInfo(), 20000);
}
function pararKeepAlive() {
  if (manterAcordado) clearInterval(manterAcordado);
  manterAcordado = null;
}

async function lerConfig() {
  return { ...PADRAO, ...(await chrome.storage.sync.get(PADRAO)) };
}

// ---------- Controles do player ----------
function carregar(frases, inicio = 0, titulo = "", aviso = "", fonte = null) {
  if (!frases.length) {
    mudar({ status: "parado", erro: "Não encontrei texto para ler nesta página." });
    return;
  }
  limparDestaque();          // apaga o destaque do texto anterior
  estado.fonte = fonte;
  estado.frases = frases;
  estado.titulo = titulo;
  estado.versao++;
  estado.erro = "";
  salvar();
  tocarDe(inicio).then(() => aviso && mudar({ erro: aviso }));
}

async function tocarDe(i) {
  if (!estado.frases.length) return;
  const minhaSessao = ++sessao;
  chrome.tts.stop();
  estado.indice = Math.max(0, Math.min(i, estado.frases.length - 1));
  mudar({ status: "tocando", erro: "" });
  salvar();
  iniciarKeepAlive();
  falarAtual(minhaSessao, await lerConfig());
}

function falarAtual(minhaSessao, config) {
  if (minhaSessao !== sessao) return;
  if (estado.indice >= estado.frases.length) {
    pararKeepAlive();
    limparDestaque();
    mudar({ status: "parado", indice: estado.frases.length });
    salvar();
    return;
  }
  const opcoes = {
    rate: Number(config.rate),
    pitch: Number(config.pitch),
    enqueue: false,
    onEvent: (ev) => {
      if (minhaSessao !== sessao) return;
      if (ev.type === "word") destacar(config, { charIndex: ev.charIndex, length: ev.length });
      if (ev.type === "end") {
        estado.indice++;
        notificar();
        salvar();
        falarAtual(minhaSessao, config);
      } else if (ev.type === "error") {
        pararKeepAlive();
        mudar({ status: "pausado", erro: "A voz deu erro: " + (ev.errorMessage || "desconhecido") + ". Tente outra voz." });
      }
    }
  };
  if (config.voiceName) opcoes.voiceName = config.voiceName;
  else opcoes.lang = "pt-BR";
  destacar(config);
  chrome.tts.speak(estado.frases[estado.indice], opcoes);
}

function pausar() {
  if (estado.status !== "tocando") return;
  sessao++;
  chrome.tts.stop();
  pararKeepAlive();
  mudar({ status: "pausado" });
  salvar();
}

function parar() {
  sessao++;
  chrome.tts.stop();
  pararKeepAlive();
  limparDestaque();
  mudar({ status: "parado" });
  salvar();
}

// ▶/⏸ : pausa, continua, recomeça ou começa a ler de onde você clicou
function alternar() {
  if (estado.status === "tocando") return pausar();
  if (estado.frases.length) {
    return tocarDe(estado.indice >= estado.frases.length ? 0 : estado.indice);
  }
  return ler("daqui");
}

// Fala uma frase de teste sem perder o texto carregado
async function testarVoz() {
  pausar();
  const config = await lerConfig();
  const opcoes = { rate: Number(config.rate), pitch: Number(config.pitch) };
  if (config.voiceName) opcoes.voiceName = config.voiceName;
  else opcoes.lang = "pt-BR";
  chrome.tts.speak("Olá! Esta é a voz que vai ler para você.", opcoes);
}

function anterior() { if (estado.frases.length) tocarDe(Math.min(estado.indice, estado.frases.length) - 1); }
function proximo() { if (estado.frases.length) tocarDe(estado.indice + 1); }

// Mudou velocidade/voz/tom no meio da leitura? Aplica na hora, repetindo a frase atual
chrome.storage.onChanged.addListener((mudancas, area) => {
  if (area !== "sync") return;
  if (mudancas.destacar && mudancas.destacar.newValue === false) limparDestaque();
  if (estado.status === "tocando") tocarDe(estado.indice);
});

// =====================================================================
//  Destaque na página: marca a frase (e a palavra) que está sendo lida
// =====================================================================
let cacheFaixas = { versao: -1 };

// Descobre, para cada frase, onde ela está no texto original da página
function faixas() {
  if (!estado.fonte?.texto) return null;
  if (cacheFaixas.versao === estado.versao) return cacheFaixas;
  const texto = estado.fonte.texto;
  // Texto "normalizado" (espaços juntados), igual ao usado para criar as frases,
  // com um mapa de volta para a posição original
  const mapa = [];
  let norm = "";
  let espaco = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (/\s/.test(c)) {
      if (!espaco && norm) { norm += " "; mapa.push(i); }
      espaco = true;
    } else {
      norm += c; mapa.push(i); espaco = false;
    }
  }
  let cursor = 0;
  const lista = estado.frases.map((f) => {
    const k = norm.indexOf(f, cursor);
    if (k < 0) return null;
    cursor = k + f.length;
    return { ini: mapa[k], fim: mapa[k + f.length - 1] + 1, k };
  });
  cacheFaixas = { versao: estado.versao, faixas: lista, mapa };
  return cacheFaixas;
}

function destacar(config, palavra = null) {
  if (!config.destacar || !estado.fonte) return;
  const c = faixas();
  const fx = c?.faixas[estado.indice];
  if (!fx) return;

  let pIni = -1, pFim = -1;
  if (palavra && palavra.charIndex >= 0) {
    const frase = estado.frases[estado.indice];
    let len = palavra.length;
    if (!(len > 0)) len = ((frase.slice(palavra.charIndex).match(/^\S+/) || [""])[0]).length;
    if (len > 0 && palavra.charIndex + len <= frase.length) {
      pIni = c.mapa[fx.k + palavra.charIndex];
      pFim = c.mapa[fx.k + palavra.charIndex + len - 1] + 1;
    }
  }
  chrome.scripting.executeScript({
    target: { tabId: estado.fonte.tabId, frameIds: [estado.fonte.frameId] },
    func: destacarNaPagina,
    args: [fx.ini, fx.fim, pIni, pFim, !palavra && !!config.rolar]
  }).catch(() => {});
}

function limparDestaque() {
  const f = estado.fonte;
  if (!f) return;
  chrome.scripting.executeScript({ target: { tabId: f.tabId, frameIds: [f.frameId] }, func: limparNaPagina }).catch(() => {});
}

// =====================================================================
//  Funções que rodam DENTRO da página (cada uma precisa ser autocontida)
// =====================================================================

// Pinta a frase [ini, fim) e a palavra [pIni, pFim) usando o mapa salvo na extração.
// Não altera o HTML do site: usa a API de destaque do navegador (ou uma camada por cima).
function destacarNaPagina(ini, fim, pIni, pFim, rolar) {
  const m = window.__leitorMapa;
  if (!m || !m.pecas.length) return false;

  const pontoInicio = (pos) => {
    for (const p of m.pecas) if (p.ini + p.len > pos) return { no: p.no, off: p.noIni + Math.max(0, pos - p.ini) };
    return null;
  };
  const pontoFim = (pos) => {
    let r = null;
    for (const p of m.pecas) {
      if (p.ini >= pos) break;
      r = { no: p.no, off: p.noIni + Math.min(p.len, pos - p.ini) };
    }
    return r;
  };
  const criar = (a, b) => {
    const s = pontoInicio(a), e = pontoFim(b);
    if (!s || !e) return null;
    const r = document.createRange();
    try {
      r.setStart(s.no, s.off);
      r.setEnd(e.no, e.off);
      if (r.collapsed) r.setEnd(s.no, s.no.length);   // frase atravessa componentes: marca o primeiro trecho
    } catch (erro) { return null; }
    return r;
  };

  const frase = criar(ini, fim);
  if (!frase) return false;
  const palavra = pIni >= 0 ? criar(pIni, pFim) : null;

  const temApi = typeof Highlight !== "undefined" && window.CSS && CSS.highlights;
  if (temApi) {
    // Estilo do destaque em cada "raiz" (página e componentes com Shadow DOM)
    const CSS_TXT = "::highlight(leitor-voz){background-color:rgba(255,204,0,.38)}" +
                    "::highlight(leitor-voz-palavra){background-color:#ffa000;color:#000}";
    window.__leitorEstilos = window.__leitorEstilos || new WeakSet();
    for (const raiz of [document.head || document.documentElement, ...(m.sombras || [])]) {
      if (!raiz || window.__leitorEstilos.has(raiz)) continue;
      const st = document.createElement("style");
      st.textContent = CSS_TXT;
      raiz.appendChild(st);
      window.__leitorEstilos.add(raiz);
    }
    CSS.highlights.set("leitor-voz", new Highlight(frase));
    if (palavra) {
      const h = new Highlight(palavra);
      h.priority = 1;
      CSS.highlights.set("leitor-voz-palavra", h);
    } else {
      CSS.highlights.delete("leitor-voz-palavra");
    }
  } else {
    // Navegador sem a API: desenha retângulos transparentes por cima do texto
    let camada = document.getElementById("__leitor-voz-camada");
    if (!camada) {
      camada = document.createElement("div");
      camada.id = "__leitor-voz-camada";
      camada.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
      document.documentElement.appendChild(camada);
      const redesenhar = () => window.__leitorDesenhar && window.__leitorDesenhar();
      window.addEventListener("scroll", redesenhar, { capture: true, passive: true });
      window.addEventListener("resize", redesenhar, { passive: true });
    }
    window.__leitorDesenhar = () => {
      camada.textContent = "";
      for (const [r, cor] of [[frase, "rgba(255,204,0,.38)"], [palavra, "rgba(255,160,0,.6)"]]) {
        if (!r) continue;
        for (const q of r.getClientRects()) {
          const b = document.createElement("div");
          b.style.cssText = `position:fixed;left:${q.left}px;top:${q.top}px;width:${q.width}px;height:${q.height}px;background:${cor};border-radius:2px`;
          camada.appendChild(b);
        }
      }
    };
    window.__leitorDesenhar();
  }

  // Rola a página para a frase atual, se ela estiver fora da tela
  if (rolar) {
    const ret = frase.getBoundingClientRect();
    if (ret.top < 60 || ret.bottom > window.innerHeight - 60) {
      const el = frase.startContainer.parentElement;
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  return true;
}

function limparNaPagina() {
  try { CSS.highlights.delete("leitor-voz"); CSS.highlights.delete("leitor-voz-palavra"); } catch (e) { /* sem API */ }
  const camada = document.getElementById("__leitor-voz-camada");
  if (camada) camada.textContent = "";
  window.__leitorDesenhar = null;
}

// modo: "selecao" | "pagina" | "daqui"
// Devolve { texto, inicio (posição do ponto marcado, ou -1), foco, t (quando você marcou) }
function extrairDaPagina(modo) {
  const R = { texto: "", inicio: -1, foco: document.hasFocus(), t: 0 };
  // Quadros invisíveis ou minúsculos (login, anúncios, rastreadores) são ignorados
  if (!document.body || window.innerWidth < 100 || window.innerHeight < 100) return R;

  const IGNORAR = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TEXTAREA", "SVG", "NAV", "FOOTER", "BUTTON", "SELECT", "IFRAME", "HEAD"]);
  const BLOCOS = "p,div,li,h1,h2,h3,h4,h5,h6,td,th,section,article,aside,header,blockquote,pre,dd,dt,figcaption,label,summary";
  const sombras = [];

  // Junta, em ordem, os textos VISÍVEIS — inclusive dentro de componentes com Shadow DOM
  function coletar(raiz, lista) {
    const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (n.nodeType === 1) {
          if (IGNORAR.has(n.tagName.toUpperCase())) return NodeFilter.FILTER_REJECT;
          if (n.checkVisibility && !n.checkVisibility()) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
        return n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });
    let n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 1) {
        if (n.shadowRoot) { sombras.push(n.shadowRoot); coletar(n.shadowRoot, lista); }
      } else {
        lista.push(n);
      }
    }
  }

  const tSel = window.__leitorSelT || 0;
  const clique = window.__leitorClique || null;

  if (modo === "selecao") {
    R.texto = String(window.getSelection() || "");
    R.t = tSel;
    return R;
  }

  // Página toda: tenta achar o bloco do conteúdo principal (pula menus e barras laterais)
  let raiz = document.body;
  if (modo === "pagina") {
    const tam = (el) => (el.innerText ?? el.textContent ?? "").trim().length;   // só para medir
    let melhor = null;
    for (const el of document.querySelectorAll("article, main, [role=main]")) {
      if (tam(el) > 500 && (!melhor || tam(el) > tam(melhor))) melhor = el;
    }
    if (!melhor) {
      const pontos = new Map();
      for (const p of document.querySelectorAll("p")) {
        const n = tam(p);
        if (n >= 40 && p.parentElement) pontos.set(p.parentElement, (pontos.get(p.parentElement) || 0) + n);
      }
      let max = 0;
      for (const [el, n] of pontos) if (n > max) { max = n; melhor = el; }
      if (max < 500) melhor = null;
    }
    if (melhor) raiz = melhor;
  }

  const nos = [];
  coletar(raiz, nos);

  // Daqui em diante: onde você marcou? (seleção/clique — o que foi mais recente)
  let alvoNo = null;
  let alvoOff = 0;
  if (modo === "daqui") {
    const sel = window.getSelection();
    let r = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    if (r) {
      try {   // seleção dentro de Shadow DOM (navegadores novos devolvem o ponto exato)
        if (sel.getComposedRanges) {
          const cr = sel.getComposedRanges({ shadowRoots: sombras })[0];
          if (cr) r = cr;
        }
      } catch (e) { /* navegador antigo: usa o range normal */ }
    }
    const cliqueMaisNovo = clique && (!r || clique.t > tSel + 300);
    // Se o clique foi dentro de um componente encapsulado mas a seleção aponta para fora dele,
    // o navegador "escondeu" o ponto exato: o clique é mais preciso
    const cliqueNoShadow = clique && clique.alvo && clique.alvo.getRootNode && clique.alvo.getRootNode() !== document;
    const selecaoForaDoShadow = r && r.startContainer.getRootNode && r.startContainer.getRootNode() === document;

    if (r && !cliqueMaisNovo && !(cliqueNoShadow && selecaoForaDoShadow)) {
      alvoNo = r.startContainer;
      alvoOff = r.startOffset;
      R.t = tSel || 1;
    } else if (clique) {
      R.t = clique.t;
      let cp = null;
      if (window.scrollX === clique.sx && window.scrollY === clique.sy && document.caretPositionFromPoint) {
        try { cp = document.caretPositionFromPoint(clique.x, clique.y, { shadowRoots: sombras }); }
        catch (e) { try { cp = document.caretPositionFromPoint(clique.x, clique.y); } catch (e2) { cp = null; } }
      }
      if (cp && cp.offsetNode) { alvoNo = cp.offsetNode; alvoOff = cp.offset; }
      else { alvoNo = clique.alvo; alvoOff = 0; }
    }
  }

  // Em qual texto da lista está o ponto marcado?
  let idx = -1;
  if (alvoNo) {
    idx = nos.indexOf(alvoNo);
    if (idx < 0) {
      const ref = (alvoNo.nodeType === 1 && alvoNo.childNodes[alvoOff]) || alvoNo;
      idx = nos.findIndex((n) => {
        if (ref === n || (ref.contains && ref.contains(n))) return true;
        const pos = ref.compareDocumentPosition(n);
        return (pos & Node.DOCUMENT_POSITION_FOLLOWING) && !(pos & Node.DOCUMENT_POSITION_DISCONNECTED);
      });
    }
  }

  // Monta o texto: cada bloco numa linha; quebra também no ponto marcado
  // "pecas" guarda onde cada pedaço do texto está na página — é o que permite destacar depois
  let texto = "";
  let blocoAnterior;
  const pecas = [];
  nos.forEach((n, i) => {
    const bloco = n.parentElement ? n.parentElement.closest(BLOCOS) : null;
    if (texto && bloco !== blocoAnterior) texto += "\n";
    blocoAnterior = bloco;
    const valor = n.nodeValue;
    if (i === idx) {
      let pos = n === alvoNo ? Math.min(alvoOff, valor.length) : 0;
      while (pos > 0 && !/\s/.test(valor[pos - 1])) pos--;   // volta ao início da palavra
      if (pos > 0) pecas.push({ no: n, noIni: 0, ini: texto.length, len: pos });
      texto += valor.slice(0, pos) + "\n";
      R.inicio = texto.length;
      pecas.push({ no: n, noIni: pos, ini: texto.length, len: valor.length - pos });
      texto += valor.slice(pos);
    } else {
      pecas.push({ no: n, noIni: 0, ini: texto.length, len: valor.length });
      texto += valor;
    }
  });
  window.__leitorMapa = { pecas, sombras };
  R.texto = texto;
  return R;
}

// =====================================================================
//  Pegar texto das abas (inclusive iframes) e de PDFs
// =====================================================================
async function executarNosQuadros(tabId, modo, frameId) {
  const alvo = frameId != null && frameId >= 0 ? { tabId, frameIds: [frameId] } : { tabId, allFrames: true };
  try {
    const resultados = await chrome.scripting.executeScript({ target: alvo, func: extrairDaPagina, args: [modo] });
    return resultados.filter((r) => r.result).map((r) => ({ ...r.result, frameId: r.frameId }));
  } catch (e) {
    console.warn("Não foi possível acessar esta aba:", e.message);
    return [];
  }
}

// Vence o quadro onde você marcou por último; depois o que tem foco; depois iframes de conteúdo
const ordemPreferencia = (a, b) =>
  (b.t - a.t) || (b.foco - a.foco) || ((b.frameId !== 0) - (a.frameId !== 0));

// Para "página toda": o quadro visível com mais texto é o conteúdo principal
const maiorQuadro = (lista) => lista.sort((a, b) => b.texto.length - a.texto.length)[0] || null;
const maiorTexto = (lista) => maiorQuadro(lista)?.texto || "";

function ehPdf(url) {
  return /\.pdf($|[?#])/i.test(url || "");
}

// ---------- PDF: o texto é extraído no documento offscreen com pdf.js ----------
async function garantirOffscreen() {
  const existentes = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existentes.length) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["DOM_PARSER"],
      justification: "Extrair o texto de PDFs para leitura em voz alta"
    });
  } catch (e) {
    if (!String(e.message).includes("single offscreen")) throw e;
  }
}

async function textoDoPdf(url) {
  await garantirOffscreen();
  const resposta = await chrome.runtime.sendMessage({ alvo: "offscreen", tipo: "pdf", url });
  if (!resposta || resposta.erro) throw new Error(resposta?.erro || "sem resposta");
  return resposta.texto;
}

// Acha em qual frase está um trecho selecionado (usado em PDFs)
function acharFrase(frases, trecho) {
  const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const primeira = dividirFrases(trecho)[0];
  if (!primeira) return 0;
  const alvo = norm(primeira).slice(0, 40);
  const i = frases.findIndex((f) => norm(f).includes(alvo));
  return i >= 0 ? i : 0;
}

async function abaAtiva() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// modo: "daqui" | "pagina" | "selecao"
// frameId e selecaoMenu vêm do botão direito (sabemos exatamente onde você clicou)
async function ler(modo, frameId, selecaoMenu = "") {
  await pronto;
  const tab = await abaAtiva();
  if (!tab) return;
  const titulo = tab.title || "";
  mudar({ status: "carregando", erro: "" });

  // --- PDF ---
  if (ehPdf(tab.url)) {
    try {
      const frases = dividirFrases(await textoDoPdf(tab.url));
      if (modo === "selecao" && selecaoMenu) return carregar(dividirFrases(selecaoMenu), 0, titulo);
      const inicio = modo === "daqui" && selecaoMenu ? acharFrase(frases, selecaoMenu) : 0;
      return carregar(frases, inicio, titulo);
    } catch (e) {
      const dica = tab.url.startsWith("file:")
        ? " Para PDFs do computador, ative \"Permitir acesso aos URLs de arquivo\" na página da extensão."
        : "";
      return mudar({ status: "parado", erro: "Não consegui abrir este PDF (" + e.message + ")." + dica });
    }
  }

  // --- Só a seleção ---
  if (modo === "selecao") {
    let texto = selecaoMenu;
    if (!texto) {
      const r = (await executarNosQuadros(tab.id, "selecao", frameId)).filter((x) => x.texto.trim());
      texto = r.sort(ordemPreferencia)[0]?.texto || "";
    }
    if (texto.trim()) return carregar(dividirFrases(texto), 0, titulo);
    modo = "pagina";
  }

  // --- Daqui em diante: carrega o texto todo e começa no ponto marcado ---
  let aviso = "";
  if (modo === "daqui") {
    let r = (await executarNosQuadros(tab.id, "daqui", frameId)).filter((x) => x.inicio >= 0);
    if (!r.length && frameId != null) {
      r = (await executarNosQuadros(tab.id, "daqui")).filter((x) => x.inicio >= 0);
    }
    const melhor = r.sort(ordemPreferencia)[0];
    if (melhor) {
      const frases = dividirFrases(melhor.texto);
      const inicio = dividirFrases(melhor.texto.slice(0, melhor.inicio)).length;
      return carregar(frases, inicio, titulo, "", { tabId: tab.id, frameId: melhor.frameId, texto: melhor.texto });
    }
    // Não achou o ponto: se veio seleção pelo menu, procura o trecho no conteúdo
    const pag = await executarNosQuadros(tab.id, "pagina");
    const q = maiorQuadro(pag);
    const frases = dividirFrases(q?.texto || "");
    if (selecaoMenu && frases.length) {
      return carregar(frases, acharFrase(frases, selecaoMenu), titulo, "", { tabId: tab.id, frameId: q.frameId, texto: q.texto });
    }
    aviso = "Não achei o ponto marcado — comecei do início. Clique numa frase aqui embaixo para pular até ela.";
  }

  // --- Página inteira ---
  const pag = await executarNosQuadros(tab.id, "pagina");
  const q = maiorQuadro(pag);
  if (!q || !q.texto.trim()) {
    return mudar({ status: "parado", erro: "Não consigo ler esta página (páginas do navegador e a loja de extensões são bloqueadas)." });
  }
  carregar(dividirFrases(q.texto), 0, titulo, aviso, { tabId: tab.id, frameId: q.frameId, texto: q.texto });
}

// =====================================================================
//  Menu do botão direito, atalhos e mensagens do popup
// =====================================================================
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "ler-daqui", title: "🔊 Ler daqui em diante", contexts: ["page", "selection", "frame", "link"] });
    chrome.contextMenus.create({ id: "ler-selecao", title: "🔊 Ler só a seleção", contexts: ["selection"] });
    chrome.contextMenus.create({ id: "ler-pagina", title: "🔊 Ler página inteira", contexts: ["page", "frame"] });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "ler-daqui") ler("daqui", info.frameId, info.selectionText || "");
  if (info.menuItemId === "ler-selecao") ler("selecao", info.frameId, info.selectionText || "");
  if (info.menuItemId === "ler-pagina") ler("pagina", info.frameId);
});

chrome.commands.onCommand.addListener(async (cmd) => {
  await pronto;
  if (cmd === "ler-daqui") ler("daqui");
  if (cmd === "pausar") alternar();
  if (cmd === "anterior") anterior();
  if (cmd === "proximo") proximo();
  if (cmd === "parar") parar();
  if (cmd === "ler-pagina") ler("pagina");
});

chrome.runtime.onMessage.addListener((msg, _remetente, responder) => {
  if (!msg || msg.alvo === "offscreen" || msg.tipo) return;
  pronto.then(() => {
    switch (msg.acao) {
      case "estado": return responder(resumo());
      case "frases": return responder({ frases: estado.frases, versao: estado.versao });
      case "daqui": ler("daqui"); break;
      case "pagina": ler("pagina"); break;
      case "selecao": ler("selecao"); break;
      case "alternar": alternar(); break;
      case "anterior": anterior(); break;
      case "proximo": proximo(); break;
      case "parar": parar(); break;
      case "irPara": tocarDe(Number(msg.indice)); break;
      case "testar": testarVoz(); break;
    }
    responder({ ok: true });
  });
  return true;   // resposta assíncrona
});
