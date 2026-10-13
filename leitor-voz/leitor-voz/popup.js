// ===== Popup: mostra o texto, destaca a frase atual e manda comandos ao background =====
const $ = (id) => document.getElementById(id);
const enviar = (acao, extra = {}) => chrome.runtime.sendMessage({ acao, ...extra });

let versaoAtual = -1;
let spans = [];
let ultimo = null;

const ICONE_PLAY = '<path d="M8 5v14l11-7z"/>';
const ICONE_PAUSA = '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>';
const NOMES_STATUS = { tocando: "lendo", pausado: "pausado", parado: "parado", carregando: "carregando…" };

$("versao").textContent = chrome.runtime.getManifest().version;

// ---------- Botões ----------
["alternar", "anterior", "proximo", "parar", "daqui", "pagina", "selecao", "testar"].forEach((id) =>
  $(id).addEventListener("click", () => enviar(id))
);
$("repetir").addEventListener("click", () => ultimo && enviar("irPara", { indice: Math.min(ultimo.indice, ultimo.total - 1) }));

// Clicar numa frase do texto pula para ela
$("texto").addEventListener("click", (e) => {
  const i = e.target.dataset?.i;
  if (i !== undefined) enviar("irPara", { indice: Number(i) });
});

// Clicar na barra de progresso pula para aquela parte
$("barra").addEventListener("click", (e) => {
  if (!ultimo?.total) return;
  const proporcao = e.offsetX / e.currentTarget.clientWidth;
  enviar("irPara", { indice: Math.floor(proporcao * ultimo.total) });
});

// ---------- Desenho ----------
async function carregarFrases() {
  const { frases, versao } = await enviar("frases");
  versaoAtual = versao;
  const caixa = $("texto");
  if (!frases.length) return;
  caixa.textContent = "";
  spans = frases.map((frase, i) => {
    const s = document.createElement("span");
    s.textContent = frase + " ";
    s.dataset.i = i;
    caixa.appendChild(s);
    return s;
  });
}

let indiceDesenhado = -1;
async function desenhar(est) {
  ultimo = est;
  if (est.versao !== versaoAtual) { await carregarFrases(); indiceDesenhado = -1; }

  $("titulo").textContent = est.titulo || (est.total ? "Texto" : "Nada carregado");
  $("status").textContent = NOMES_STATUS[est.status] || est.status;
  $("status").className = "status " + est.status;
  $("iconePlay").innerHTML = est.status === "tocando" ? ICONE_PAUSA : ICONE_PLAY;
  $("erro").textContent = est.erro || "";

  const atual = Math.min(est.indice, est.total);
  $("contador").textContent = est.total
    ? (atual >= est.total ? `Fim — ${est.total} frases` : `Frase ${atual + 1} de ${est.total}`)
    : " ";
  $("progresso").style.width = est.total ? `${(atual / est.total) * 100}%` : "0";

  if (atual !== indiceDesenhado && spans.length) {
    spans.forEach((s, i) => {
      s.classList.toggle("lido", i < atual);
      s.classList.toggle("atual", i === atual);
    });
    spans[atual]?.scrollIntoView({ block: "center", behavior: indiceDesenhado < 0 ? "auto" : "smooth" });
    indiceDesenhado = atual;
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.tipo === "estado") desenhar(msg.estado);
});
enviar("estado").then(desenhar);

// ---------- Ajustes: voz, velocidade, tom ----------
const selVoz = $("voz");
const vel = $("vel");
const tom = $("tom");

function marcarVelocidade(v) {
  $("velValor").textContent = Number(v).toFixed(2).replace(/0$/, "");
  vel.value = v;
  document.querySelectorAll("#velocidades button").forEach((b) =>
    b.classList.toggle("ativo", Math.abs(Number(b.dataset.v) - v) < 0.01)
  );
}

document.querySelectorAll("#velocidades button").forEach((b) =>
  b.addEventListener("click", () => {
    marcarVelocidade(Number(b.dataset.v));
    chrome.storage.sync.set({ rate: Number(b.dataset.v) });
  })
);

chrome.tts.getVoices(async (vozes) => {
  const { voiceName = "", rate = 1, pitch = 1, destacar = true, rolar = true } =
    await chrome.storage.sync.get(["voiceName", "rate", "pitch", "destacar", "rolar"]);
  $("destacar").checked = destacar;
  $("rolar").checked = rolar;
  const pt = vozes.filter((v) => (v.lang || "").toLowerCase().startsWith("pt"));
  const outras = vozes.filter((v) => !pt.includes(v)).sort((a, b) => (a.lang || "").localeCompare(b.lang || ""));

  selVoz.add(new Option("Automática (pt-BR)", ""));
  const grupo = (rotulo, lista) => {
    if (!lista.length) return;
    const g = document.createElement("optgroup");
    g.label = rotulo;
    lista.forEach((v) => g.appendChild(new Option(`${v.voiceName} (${v.lang || "?"})${v.remote ? " ☁" : ""}`, v.voiceName)));
    selVoz.appendChild(g);
  };
  grupo("Português", pt);
  grupo("Outros idiomas", outras);

  selVoz.value = voiceName;
  marcarVelocidade(rate);
  tom.value = pitch;
  $("tomValor").textContent = Number(pitch).toFixed(2);
});

selVoz.addEventListener("change", () => chrome.storage.sync.set({ voiceName: selVoz.value }));
$("destacar").addEventListener("change", (e) => chrome.storage.sync.set({ destacar: e.target.checked }));
$("rolar").addEventListener("change", (e) => chrome.storage.sync.set({ rolar: e.target.checked }));

// "input" só atualiza o número; salva quando você solta o controle
vel.addEventListener("input", () => marcarVelocidade(Number(vel.value)));
vel.addEventListener("change", () => chrome.storage.sync.set({ rate: Number(vel.value) }));
tom.addEventListener("input", () => ($("tomValor").textContent = Number(tom.value).toFixed(2)));
tom.addEventListener("change", () => chrome.storage.sync.set({ pitch: Number(tom.value) }));
