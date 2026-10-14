import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io, Socket } from "socket.io-client";
import QRCode from "qrcode";
import "./style.css";
type State = any;
const phaseNames: Record<string, string> = {
  lobby: "Собираемся",
  board: "Выбор вопроса",
  question: "Приготовьтесь",
  open: "Можно отвечать",
  answering: "Игрок отвечает",
  revealed: "Ответ раскрыт",
  paused: "Пауза",
  finished: "Финальные результаты",
};
async function api(url: string, body?: unknown) {
  const r = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.error || "Ошибка запроса");
  return v;
}
function useGame(auth: any) {
  const [s, setS] = useState<State>(null),
    [connected, setConnected] = useState(false),
    [error, setError] = useState("");
  const sock = useRef<Socket | null>(null);
  useEffect(() => {
    if (!auth) return;
    const socket = io({ auth, reconnection: true });
    sock.current = socket;
    socket.on("connect", () => {
      setConnected(true);
      setError("");
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", (e) => {
      setConnected(false);
      setError(e.message);
    });
    socket.on("state", setS);
    return () => {
      socket.disconnect();
      sock.current = null;
    };
  }, [JSON.stringify(auth)]);
  return { s, connected, error, setError, sock };
}
function Header({
  connected,
  label = "АНТОНУ — 28",
}: {
  connected?: boolean;
  label?: string;
}) {
  return (
    <header>
      <a className="brand" href="/">
        СВОЯ ИГРА
      </a>
      <span className="eyebrow">{label}</span>
      <span className={"connection " + (connected ? "live" : "")}>
        {connected ? "В эфире" : "Не подключён"}
      </span>
    </header>
  );
}
function Timer({ s }: { s: State }) {
  const [time, setTime] = useState(Date.now());
  const offset = useRef(0);
  useEffect(() => {
    offset.current = s.serverTime - Date.now();
  }, [s.serverTime]);
  useEffect(() => {
    const t = setInterval(() => setTime(Date.now() + offset.current), 100);
    return () => clearInterval(t);
  }, []);
  return s.deadline ? (
    <span className="timer">
      {Math.max(0, Math.ceil((s.deadline - time) / 1000))}
      <small> сек</small>
    </span>
  ) : null;
}
function Scores({
  s,
  adjust,
}: {
  s: State;
  adjust?: (id: string, n: number) => void;
}) {
  return (
    <div className="scores">
      {[...s.players]
        .sort((a, b) => b.scores[s.mode] - a.scores[s.mode])
        .map((p: any, i: number) => (
          <div
            className={"score-row " + (p.id === s.winner ? "winner" : "")}
            key={p.id}
          >
            <span className="rank">{String(i + 1).padStart(2, "0")}</span>
            <span className={"dot " + (s.online?.includes(p.id) ? "on" : "")} />
            <strong>{p.name}</strong>
            <b>{p.scores[s.mode]}</b>
            {adjust && (
              <>
                <button className="tiny" onClick={() => adjust(p.id, -100)}>
                  −100
                </button>
                <button className="tiny" onClick={() => adjust(p.id, 100)}>
                  +100
                </button>
              </>
            )}
          </div>
        ))}
      {!s.players.length && (
        <p className="muted">Игроки появятся здесь после входа.</p>
      )}
    </div>
  );
}
function Board({ s, select }: { s: State; select?: (id: string) => void }) {
  if (s.mode === "melody")
    return (
      <div className="track-grid">
        {s.tracks.map((t: any, i: number) => (
          <button
            className="track"
            key={t.id}
            disabled={!select || s.used.includes(t.id) || s.phase !== "board"}
            onClick={() => select?.(t.id)}
          >
            <span>♪</span>
            <b>{t.label}</b>
            <small>
              {s.used.includes(t.id) ? "Сыгран" : "Музыкальный раунд"}
            </small>
          </button>
        ))}
        {!s.tracks.length && (
          <div className="empty">
            <span>♫</span>
            <h2>Пока тихо</h2>
            <p>Добавьте песни в редакторе ведущего.</p>
          </div>
        )}
      </div>
    );
  const cats = [...new Set<string>(s.board.map((q: any) => q.category))];
  return (
    <div className="board">
      {cats.map((cat) => (
        <div className="board-row" key={cat}>
          <div className="category">{cat}</div>
          <div className="cells">
            {s.board
              .filter((q: any) => q.category === cat)
              .sort((a: any, b: any) => a.value - b.value)
              .map((q: any) => (
                <button
                  className="cell"
                  disabled={
                    !select || s.used.includes(q.id) || s.phase !== "board"
                  }
                  key={q.id}
                  onClick={() => select?.(q.id)}
                >
                  {s.used.includes(q.id) ? "—" : q.value}
                </button>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
function Join() {
  const [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [player, setPlayer] = useState<any>(() => {
      try {
        return JSON.parse(localStorage.getItem("svoya-player") || "null");
      } catch {
        return null;
      }
    });
  const {
    s,
    connected,
    error: socketError,
    setError: setSocketError,
    sock,
  } = useGame(player ? { role: "player", token: player.token } : null);
  const [pressed, setPressed] = useState(false);
  useEffect(() => setPressed(false), [s?.epoch]);
  async function join(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await api("/api/join", { name });
      localStorage.setItem("svoya-player", JSON.stringify(p));
      setPlayer(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const me = s?.players.find((x: any) => x.id === player?.id);
  const canBuzz =
    connected &&
    s?.phase === "open" &&
    !s.blocked.includes(player?.id) &&
    !pressed;
  function press() {
    if (!canBuzz) return;
    setPressed(true);
    navigator.vibrate?.(35);
    sock.current
      ?.timeout(3000)
      .emit("buzz", { epoch: s.epoch }, (err: any, r: any) => {
        if (err || !r?.ok) {
          setSocketError(r?.error || "Не удалось подтвердить нажатие");
          setPressed(false);
        }
      });
  }
  return (
    <>
      <Header connected={connected} />
      <main className="phone">
        {!player ? (
          <>
            <div className="tag">ДВЕ ИГРЫ · ОДИН ВЕЧЕР</div>
            <h1>
              Сегодня
              <br />
              всё <em>про нас.</em>
            </h1>
            <p className="intro">
              Своя игра и угадай мелодию.
              <br />
              Занимай место — скоро начинаем.
            </p>
            <form onSubmit={join} className="join-form">
              <label>Как тебя представить?</label>
              <input
                autoComplete="nickname"
                value={name}
                maxLength={24}
                placeholder="Твоё имя"
                onChange={(e) => setName(e.target.value)}
                required
              />
              <button className="primary" disabled={busy}>
                {busy ? "Подключаем…" : "Я в игре →"}
              </button>
            </form>
            {error && <p className="error">{error}</p>}
            <footer>
              Телефон — твоя кнопка.
              <br />
              Вопросы и музыка — на большом экране.
            </footer>
          </>
        ) : !s ? (
          <div className="empty">
            <h2>Подключаемся…</h2>
            <p className="error">{socketError}</p>
            <button
              onClick={() => {
                localStorage.removeItem("svoya-player");
                setPlayer(null);
              }}
            >
              Вернуться ко входу
            </button>
          </div>
        ) : (
          <>
            <div className="player-heading">
              <div>
                <span className="eyebrow">
                  {s.mode === "quiz" ? "СВОЯ ИГРА" : "УГАДАЙ МЕЛОДИЮ"}
                </span>
                <h2>{me?.name || player.name}</h2>
              </div>
              <div className="my-score">
                {me?.scores[s.mode] || 0}
                <small>баллов</small>
              </div>
            </div>
            <div className="status-line">
              <span>{phaseNames[s.phase]}</span>
              <Timer s={s} />
            </div>
            {s.phase === "finished" ? (
              <>
                <h1 className="small-title">
                  Вот это
                  <br />
                  <em>была игра.</em>
                </h1>
                <Scores s={s} />
              </>
            ) : (
              <>
                <button
                  className={
                    "buzzer " +
                    (canBuzz ? "armed" : "") +
                    (s.winner === player.id ? " yours" : "")
                  }
                  onPointerDown={(e) => {
                    e.preventDefault();
                    press();
                  }}
                  onClick={(e) => {
                    if (e.detail === 0) press();
                  }}
                  disabled={!canBuzz}
                >
                  <span>
                    {s.winner === player.id ? "ТВОЙ" : canBuzz ? "Я" : "ЖДЁМ"}
                  </span>
                  <b>
                    {s.winner === player.id
                      ? "ОТВЕТ"
                      : canBuzz
                        ? "ЗНАЮ!"
                        : "СИГНАЛА"}
                  </b>
                  <small>
                    {canBuzz
                      ? "Нажми первым"
                      : s.winner === player.id
                        ? "Отвечай вслух"
                        : "Следи за большим экраном"}
                  </small>
                </button>
                {s.winner && s.winner !== player.id && (
                  <p className="callout">
                    Отвечает{" "}
                    <b>{s.players.find((p: any) => p.id === s.winner)?.name}</b>
                  </p>
                )}
                {s.blocked.includes(player.id) && (
                  <p className="muted">На этом этапе ты уже отвечал.</p>
                )}
                <div className="section-line">
                  <span>ТАБЛИЦА ИГРОКОВ</span>
                  <span>{s.players.length} участников</span>
                </div>
                <Scores s={s} />
              </>
            )}
            {!connected && (
              <p className="error">Связь потеряна. Подключаемся заново…</p>
            )}
            {socketError && <p className="error">{socketError}</p>}
          </>
        )}
      </main>
    </>
  );
}
function QR({ url }: { url: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(url, {
      width: 240,
      margin: 2,
      color: { dark: "#101119", light: "#ffffff" },
    }).then(setSrc);
  }, [url]);
  return <img className="qr" src={src} alt="QR-код для входа" />;
}
function Media({
  s,
  tvKey,
  socket,
}: {
  s: State;
  tvKey: string;
  socket: Socket | null;
}) {
  const ref = useRef<HTMLMediaElement | null>(null);
  const [loaded, setLoaded] = useState("");
  const media = s.current?.media;
  const currentId = s.current?.id;
  const start = s.current?.start || 0;
  const duration = s.current?.seconds || 0;
  const phase = useRef(s.phase);
  phase.current = s.phase;
  useEffect(() => {
    if (
      !s.tv.ready &&
      (!media || loaded === media || (ref.current?.readyState || 0) >= 3)
    )
      socket?.emit("tv:ready", { id: currentId || null, step: s.step });
  }, [currentId, media, s.step, s.tv.ready, loaded, socket]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let stopped = false;
    async function run() {
      if (s.phase === "open") {
        el!.pause();
        el!.currentTime = start;
        try {
          await el!.play();
          if (stopped || phase.current !== "open") el!.pause();
        } catch {
          socket?.emit("tv:error", {
            message: "Разрешите воспроизведение на экране",
          });
        }
      } else el!.pause();
    }
    run();
    const timer = setInterval(() => {
      if (duration && el.currentTime >= start + duration) el.pause();
    }, 25);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [s.phase, s.playId, start, duration]);
  if (!media) return null;
  const url = "/media/" + media + "?key=" + encodeURIComponent(tvKey);
  const ready = () => {
    setLoaded(media);
    socket?.emit("tv:ready", { id: currentId, step: s.step });
  };
  const error = () =>
    socket?.emit("tv:error", { message: "Не удалось загрузить медиа" });
  if (/\.(jpg|png|webp)$/.test(media))
    return (
      <img
        className="question-image"
        src={url}
        onLoad={ready}
        onError={error}
      />
    );
  if (media.endsWith(".mp4"))
    return (
      <video
        className="question-image"
        src={url}
        ref={(el) => {
          ref.current = el;
        }}
        preload="auto"
        onCanPlayThrough={ready}
        onError={error}
      />
    );
  return (
    <audio
      src={url}
      ref={(el) => {
        ref.current = el;
      }}
      preload="auto"
      onCanPlayThrough={ready}
      onError={error}
    />
  );
}
function Screen() {
  const [key, setKey] = useState(sessionStorage.getItem("svoya-tv-key") || ""),
    [active, setActive] = useState(false),
    [url, setUrl] = useState(location.origin);
  const { s, connected, error, sock } = useGame(
    active ? { role: "tv", key } : null,
  );
  return (
    <>
      <Header connected={connected} label="БОЛЬШОЙ ЭКРАН" />
      {!active ? (
        <main className="phone">
          <h1>
            Большой
            <br />
            <em>вечер.</em>
          </h1>
          <p>Введите ключ экрана из пульта ведущего.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sessionStorage.setItem("svoya-tv-key", key);
              setActive(true);
            }}
          >
            <input
              value={key}
              placeholder="Ключ ТВ"
              onChange={(e) => setKey(e.target.value)}
              required
            />
            <input
              value={url}
              placeholder="Адрес для QR-кода"
              onChange={(e) => setUrl(e.target.value)}
            />
            <button className="primary">Включить экран</button>
          </form>
        </main>
      ) : !s ? (
        <main className="phone">
          <p>{error || "Подключаемся…"}</p>
          <button onClick={() => setActive(false)}>Изменить ключ</button>
        </main>
      ) : (
        <main className="tv">
          <div className="tv-title">
            <span className="eyebrow">
              {s.title} / {s.mode === "quiz" ? "СВОЯ ИГРА" : "УГАДАЙ МЕЛОДИЮ"}
            </span>
            <Timer s={s} />
          </div>
          {s.phase === "lobby" ? (
            <div className="lobby">
              <div>
                <div className="tag">ПРИСОЕДИНЯЙСЯ</div>
                <h1>
                  Все свои.
                  <br />
                  <em>Все в игре.</em>
                </h1>
                <p>Сканируй QR-код и введи своё имя.</p>
                <code>{url}</code>
              </div>
              <QR url={url} />
            </div>
          ) : s.phase === "board" ? (
            <Board s={s} />
          ) : s.phase === "finished" ? (
            <>
              <h1>
                Аплодисменты
                <br />
                <em>победителям.</em>
              </h1>
            </>
          ) : (
            <div className="tv-question">
              <div className="tag">
                {s.current?.value} БАЛЛОВ
                {s.mode === "melody" ? ` · ФРАГМЕНТ ${s.step + 1}` : ""}
              </div>
              <h1>{s.current?.text}</h1>
              {s.mode === "melody" && (
                <div
                  className={"wave " + (s.phase === "open" ? "playing" : "")}
                >
                  {Array.from({ length: 29 }, (_, i) => (
                    <i
                      key={i}
                      style={{
                        height: 20 + ((i * 37) % 85),
                        animationDelay: `${i * 0.07}s`,
                      }}
                    />
                  ))}
                </div>
              )}
              <Media s={s} tvKey={key} socket={sock.current} />
              {s.phase === "revealed" && (
                <div className="answer">{s.current?.answer}</div>
              )}
              <div className="tv-prompt">
                {s.phase === "answering"
                  ? `Отвечает ${s.players.find((p: any) => p.id === s.winner)?.name}`
                  : phaseNames[s.phase]}
              </div>
            </div>
          )}
          <div className="tv-scores">
            <Scores s={s} />
          </div>
          {!connected && (
            <div className="disconnect">Связь с сервером потеряна</div>
          )}
        </main>
      )}
    </>
  );
}
function Editor({
  pack,
  onSave,
  onClose,
  saveError,
}: {
  pack: any;
  onSave: (p: any) => void;
  onClose: () => void;
  saveError?: string;
}) {
  const [draft, setDraft] = useState<any>(() => structuredClone(pack)),
    [selected, setSelected] = useState(""),
    [kind, setKind] = useState<"questions" | "tracks">("questions"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const items = draft[kind];
  const item = items.find((x: any) => x.id === selected);
  function change(k: string, v: any) {
    setDraft({
      ...draft,
      [kind]: items.map((x: any) => (x.id === selected ? { ...x, [k]: v } : x)),
    });
  }
  function add() {
    const id = crypto.randomUUID?.() || `item-${Date.now()}`;
    const entry =
      kind === "questions"
        ? {
            id,
            category: "Новая категория",
            value: 100,
            text: "Новый вопрос",
            answer: "Ответ",
            notes: "",
          }
        : {
            id,
            answer: "Исполнитель — название",
            notes: "",
            media: "",
            start: 0,
            steps: [
              { seconds: 1, points: 500 },
              { seconds: 3, points: 400 },
              { seconds: 5, points: 300 },
              { seconds: 10, points: 200 },
              { seconds: 20, points: 100 },
            ],
          };
    setDraft({ ...draft, [kind]: [...items, entry] });
    setSelected(id);
  }
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch("/api/media", { method: "POST", body: fd });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error);
      change("media", v.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal">
      <div className="editor">
        <div className="editor-head">
          <h2>Редактор вечера</h2>
          <button onClick={onClose}>Закрыть ✕</button>
        </div>
        <label>
          Название вечера
          <input
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </label>
        <div className="tabs">
          <button
            className={kind === "questions" ? "active" : ""}
            onClick={() => {
              setKind("questions");
              setSelected("");
            }}
          >
            Вопросы ({draft.questions.length})
          </button>
          <button
            className={kind === "tracks" ? "active" : ""}
            onClick={() => {
              setKind("tracks");
              setSelected("");
            }}
          >
            Мелодии ({draft.tracks.length})
          </button>
          <button onClick={add}>+ Добавить</button>
        </div>
        <div className="editor-body">
          <nav>
            {items.map((x: any, i: number) => (
              <button
                className={x.id === selected ? "active" : ""}
                key={x.id}
                onClick={() => setSelected(x.id)}
              >
                {kind === "questions"
                  ? `${x.category} · ${x.value}`
                  : `${i + 1}. ${x.answer}`}
              </button>
            ))}
          </nav>
          <section>
            {!item ? (
              <p className="muted">
                Выберите карточку слева или добавьте новую.
              </p>
            ) : (
              <>
                {kind === "questions" ? (
                  <>
                    <div className="two">
                      <label>
                        Категория
                        <input
                          value={item.category}
                          onChange={(e) => change("category", e.target.value)}
                        />
                      </label>
                      <label>
                        Баллы
                        <input
                          type="number"
                          min="1"
                          value={item.value}
                          onChange={(e) =>
                            change("value", Number(e.target.value))
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Вопрос
                      <textarea
                        rows={4}
                        value={item.text}
                        onChange={(e) => change("text", e.target.value)}
                      />
                    </label>
                  </>
                ) : (
                  <label>
                    Начало фрагмента, секунды
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={item.start}
                      onChange={(e) => change("start", Number(e.target.value))}
                    />
                  </label>
                )}
                <label>
                  Правильный ответ
                  <input
                    value={item.answer}
                    onChange={(e) => change("answer", e.target.value)}
                  />
                </label>
                <label>
                  Заметки ведущего
                  <textarea
                    value={item.notes}
                    onChange={(e) => change("notes", e.target.value)}
                  />
                </label>
                <label>
                  {kind === "questions"
                    ? "Фото или видео"
                    : "Музыка (до 100 МБ)"}
                  <input
                    type="file"
                    accept={
                      kind === "questions"
                        ? ".jpg,.png,.webp,.mp4"
                        : ".mp3,.wav,.m4a,.ogg"
                    }
                    disabled={busy}
                    onChange={(e) => upload(e.target.files?.[0])}
                  />
                </label>
                <p className="muted">
                  {busy
                    ? "Загружаем…"
                    : item.media
                      ? "✓ Файл загружен"
                      : "Файл не выбран"}
                </p>
                {item.media && (
                  <>
                    {kind === "tracks" ? (
                      <audio controls src={"/media/" + item.media} />
                    ) : item.media.endsWith(".mp4") ? (
                      <video
                        controls
                        width="240"
                        src={"/media/" + item.media}
                      />
                    ) : (
                      <img width="160" src={"/media/" + item.media} />
                    )}
                    <button
                      className="tiny"
                      onClick={() => change("media", undefined)}
                    >
                      Удалить из карточки
                    </button>
                  </>
                )}
                {kind === "tracks" && (
                  <>
                    <div className="section-line">ДЛИТЕЛЬНОСТЬ / БАЛЛЫ</div>
                    {item.steps.map((st: any, i: number) => (
                      <div className="two" key={i}>
                        <label>
                          Секунды
                          <input
                            type="number"
                            min="0.5"
                            step="0.5"
                            value={st.seconds}
                            onChange={(e) =>
                              change(
                                "steps",
                                item.steps.map((v: any, j: number) =>
                                  j === i
                                    ? { ...v, seconds: Number(e.target.value) }
                                    : v,
                                ),
                              )
                            }
                          />
                        </label>
                        <label>
                          Баллы
                          <input
                            type="number"
                            min="1"
                            value={st.points}
                            onChange={(e) =>
                              change(
                                "steps",
                                item.steps.map((v: any, j: number) =>
                                  j === i
                                    ? { ...v, points: Number(e.target.value) }
                                    : v,
                                ),
                              )
                            }
                          />
                        </label>
                      </div>
                    ))}
                  </>
                )}
                <button
                  className="danger"
                  onClick={() => {
                    setDraft({
                      ...draft,
                      [kind]: items.filter((x: any) => x.id !== selected),
                    });
                    setSelected("");
                  }}
                >
                  Удалить карточку
                </button>
              </>
            )}
          </section>
        </div>
        {(error || saveError) && <p className="error">{error || saveError}</p>}
        <div className="editor-foot">
          <span className="muted">
            Сохранение пакета откроет все ячейки заново. Баллы сохранятся.
          </span>
          <button
            className="primary"
            disabled={busy}
            onClick={() => onSave(draft)}
          >
            Сохранить пакет
          </button>
        </div>
      </div>
    </div>
  );
}
function Admin() {
  const [logged, setLogged] = useState(false),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [meta, setMeta] = useState<any>(null),
    [tab, setTab] = useState("game"),
    [editor, setEditor] = useState(false),
    [busy, setBusy] = useState(false);
  const {
    s,
    connected,
    error: socketError,
    sock,
  } = useGame(logged ? { role: "admin" } : null);
  useEffect(() => {
    api("/api/admin")
      .then((m) => {
        setMeta(m);
        setLogged(true);
      })
      .catch(() => {});
  }, []);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/login", { password });
      setMeta(await api("/api/admin"));
      setLogged(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function cmd(type: string, payload: any = {}, after?: () => void) {
    if (!connected || busy) return;
    setBusy(true);
    setError("");
    const id =
      globalThis.crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    sock.current
      ?.timeout(5000)
      .emit(
        "command",
        { id, revision: s.revision, type, payload },
        (err: any, r: any) => {
          setBusy(false);
          if (err || !r?.ok)
            setError(
              r?.error ||
                "Команда не подтверждена. Проверьте состояние перед повтором.",
            );
          else after?.();
        },
      );
  }
  function download() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(s.pack, null, 2)], { type: "application/json" }),
    );
    a.download = "svoya-pack.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <>
      <Header connected={connected} label="ПУЛЬТ ВЕДУЩЕГО" />
      {!logged ? (
        <main className="phone">
          <div className="tag">ЗА КУЛИСАМИ</div>
          <h1>
            Ты задаёшь
            <br />
            <em>ритм.</em>
          </h1>
          <form onSubmit={login}>
            <label>
              Пароль ведущего
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button className="primary">Открыть пульт →</button>
          </form>
          {error && <p className="error">{error}</p>}
        </main>
      ) : !s ? (
        <main className="phone">
          <p>{socketError || "Подключение к эфиру…"}</p>
          <button onClick={() => location.reload()}>Обновить</button>
        </main>
      ) : (
        <main className="admin">
          <div className="admin-heading">
            <div>
              <span className="eyebrow">ТВОЁ ШОУ. ТВОИ ПРАВИЛА.</span>
              <h1>{s.title}</h1>
            </div>
            <div className={"tv-status " + (s.tv.ready ? "ready" : "")}>
              ◉ Экран:{" "}
              {s.tv.ready
                ? "готов"
                : s.tv.connected
                  ? "подключён"
                  : "не подключён"}
            </div>
          </div>
          <div className="toolbar">
            <div className="tabs">
              <button
                className={tab === "game" ? "active" : ""}
                onClick={() => setTab("game")}
              >
                Эфир
              </button>
              <button
                className={tab === "room" ? "active" : ""}
                onClick={() => setTab("room")}
              >
                Комната
              </button>
              <button
                className={tab === "history" ? "active" : ""}
                onClick={() => setTab("history")}
              >
                История
              </button>
            </div>
            <button
              disabled={!["lobby", "board", "finished"].includes(s.phase)}
              onClick={() => setEditor(true)}
            >
              ✎ Редактор
            </button>
            <a className="button" href="/screen" target="_blank">
              Открыть экран ↗
            </a>
          </div>
          {(error || socketError) && (
            <p className="error" role="alert">
              {error || socketError}
            </p>
          )}
          {!connected && (
            <p className="error">
              Нет соединения. Управление временно заблокировано.
            </p>
          )}
          {tab === "game" ? (
            <div className="admin-grid">
              <section>
                <div className="mode-bar">
                  <div className="tabs">
                    <button
                      disabled={
                        busy ||
                        !["lobby", "board", "finished", "revealed"].includes(
                          s.phase,
                        )
                      }
                      className={s.mode === "quiz" ? "active" : ""}
                      onClick={() => cmd("mode", { mode: "quiz" })}
                    >
                      Своя игра
                    </button>
                    <button
                      disabled={
                        busy ||
                        !["lobby", "board", "finished", "revealed"].includes(
                          s.phase,
                        )
                      }
                      className={s.mode === "melody" ? "active" : ""}
                      onClick={() => cmd("mode", { mode: "melody" })}
                    >
                      Угадай мелодию
                    </button>
                  </div>
                  <span className="muted">{phaseNames[s.phase]}</span>
                </div>
                {s.phase === "lobby" ? (
                  <div className="panel welcome">
                    <span className="tag">ГОТОВНОСТЬ К ЭФИРУ</span>
                    <h2>Собираем своих</h2>
                    <p>Открой экран, пригласи друзей и начинай.</p>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => cmd("start")}
                    >
                      Начать игру →
                    </button>
                  </div>
                ) : s.phase === "board" ? (
                  <>
                    <Board s={s} select={(id) => cmd("select", { id })} />
                    <p className="muted">
                      Выбирает:{" "}
                      {s.players.find((p: any) => p.id === s.chooser)?.name ||
                        "ведущий"}
                    </p>
                  </>
                ) : s.phase === "finished" ? (
                  <div className="panel">
                    <h2>Вечер, который запомнится</h2>
                    <Scores s={s} />
                    <button onClick={() => cmd("start")}>
                      Вернуться к полю
                    </button>
                  </div>
                ) : (
                  <div className="panel question-panel">
                    <div className="section-line">
                      <span>
                        {s.mode === "quiz" ? "ВОПРОС" : "МЕЛОДИЯ"} ·{" "}
                        {s.current?.value} БАЛЛОВ
                      </span>
                      <Timer s={s} />
                    </div>
                    <h2>{s.current?.text}</h2>
                    {s.mode === "melody" && (
                      <p>
                        Фрагмент {s.step + 1} из {s.current?.steps} ·{" "}
                        {s.current?.seconds} сек
                      </p>
                    )}
                    <div className="host-answer">
                      <span className="eyebrow">ТОЛЬКО ДЛЯ ВЕДУЩЕГО</span>
                      <p>{s.current?.answer}</p>
                      {s.current?.notes && <small>{s.current.notes}</small>}
                    </div>
                    {s.winner && (
                      <div className="callout">
                        Первым нажал:{" "}
                        <b>
                          {s.players.find((p: any) => p.id === s.winner)?.name}
                        </b>
                      </div>
                    )}
                    <div className="controls">
                      {s.phase === "question" && (
                        <button
                          className="primary"
                          disabled={busy || !s.tv.ready}
                          onClick={() => cmd("open")}
                        >
                          {s.mode === "melody"
                            ? "▶ Играть фрагмент"
                            : "Открыть кнопки"}
                        </button>
                      )}
                      {s.phase === "answering" && (
                        <>
                          <button
                            className="correct"
                            disabled={busy}
                            onClick={() => cmd("correct")}
                          >
                            ✓ Верно
                          </button>
                          <button
                            className="danger"
                            disabled={busy}
                            onClick={() => cmd("wrong")}
                          >
                            ✕ Неверно
                          </button>
                        </>
                      )}
                      {s.mode === "melody" &&
                        ["question", "open"].includes(s.phase) &&
                        s.step + 1 < s.current?.steps && (
                          <button
                            disabled={busy}
                            onClick={() => cmd("nextStep")}
                          >
                            Следующий фрагмент →
                          </button>
                        )}
                      {["question", "open", "answering"].includes(s.phase) && (
                        <button disabled={busy} onClick={() => cmd("pause")}>
                          Ⅱ Пауза
                        </button>
                      )}
                      {s.phase === "paused" && (
                        <button
                          disabled={busy || !s.tv.connected}
                          onClick={() => cmd("resume")}
                        >
                          Продолжить
                        </button>
                      )}
                      {["question", "open", "answering", "paused"].includes(
                        s.phase,
                      ) && (
                        <button disabled={busy} onClick={() => cmd("reveal")}>
                          Показать ответ
                        </button>
                      )}
                      {s.phase === "revealed" && (
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() => cmd("board")}
                        >
                          К игровому полю →
                        </button>
                      )}
                    </div>
                  </div>
                )}
                <div className="bottom-controls">
                  <button disabled={busy} onClick={() => cmd("undo")}>
                    ↶ Отменить действие
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (confirm("Завершить игру и показать результаты?"))
                        cmd("finish");
                    }}
                  >
                    Завершить игру
                  </button>
                </div>
              </section>
              <aside className="panel">
                <div className="section-line">
                  <span>ИГРОКИ</span>
                  <span>{s.players.length}</span>
                </div>
                <Scores
                  s={s}
                  adjust={(id, delta) => cmd("score", { id, delta })}
                />
                <p className="muted small">
                  Корректировки относятся к текущей игре.
                </p>
              </aside>
            </div>
          ) : tab === "room" ? (
            <div className="room-grid">
              <div className="panel">
                <h2>Вход для игроков</h2>
                <QR url={meta.publicUrl || location.origin} />
                <p>
                  <code>{meta.publicUrl || location.origin}</code>
                </p>
                <button onClick={() => cmd("lock", { locked: !s.locked })}>
                  {s.locked ? "Открыть вход" : "Закрыть вход"}
                </button>
                <h3>Подключение телевизора</h3>
                <p className="muted">
                  В APK укажите адрес сервера и этот ключ.
                </p>
                <code className="key">{meta.tvKey}</code>
              </div>
              <div className="panel">
                <h2>Настройки</h2>
                <label>
                  Секунд на устный ответ
                  <input
                    type="number"
                    min="3"
                    max="120"
                    defaultValue={s.settings.answerSeconds}
                    key={"a" + s.settings.answerSeconds}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (n !== s.settings.answerSeconds)
                        cmd("settings", { ...s.settings, answerSeconds: n });
                    }}
                  />
                </label>
                <label>
                  Секунд на нажатие после вопроса / фрагмента
                  <input
                    type="number"
                    min="3"
                    max="120"
                    defaultValue={s.settings.openSeconds}
                    key={"o" + s.settings.openSeconds}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      if (n !== s.settings.openSeconds)
                        cmd("settings", { ...s.settings, openSeconds: n });
                    }}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={s.settings.wrongPenalty}
                    onChange={(e) =>
                      cmd("settings", {
                        ...s.settings,
                        wrongPenalty: e.target.checked,
                      })
                    }
                  />
                  Штраф за ошибку в «Своей игре»
                </label>
                <div className="controls">
                  <button onClick={download}>Экспорт вопросов JSON</button>
                  <label className="button">
                    Импорт JSON
                    <input
                      hidden
                      type="file"
                      accept=".json"
                      onChange={async (e) => {
                        try {
                          const f = e.target.files?.[0];
                          if (
                            f &&
                            confirm("Заменить пакет? Ячейки откроются заново.")
                          )
                            cmd("pack", JSON.parse(await f.text()));
                        } catch {
                          setError("Не удалось прочитать JSON");
                        }
                      }}
                    />
                  </label>
                </div>
                <p className="muted small">
                  JSON содержит вопросы и ссылки на медиа. Для переноса музыки
                  копируйте также каталог data.
                </p>
                <button
                  className="danger"
                  onClick={() => {
                    if (
                      confirm(
                        "Сбросить все баллы и начать заново? Игроки и вопросы останутся.",
                      )
                    )
                      cmd("reset");
                  }}
                >
                  Новый вечер: сбросить баллы
                </button>
                <button
                  onClick={async () => {
                    await api("/api/logout", {});
                    setLogged(false);
                  }}
                >
                  Выйти из пульта
                </button>
              </div>
            </div>
          ) : (
            <div className="panel">
              <h2>Хроника вечера</h2>
              {s.attempts.length > 0 && (
                <>
                  <h3>Нажатия текущего вопроса</h3>
                  {s.attempts.map((a: any, i: number) => (
                    <p key={i} className="log">
                      <time>
                        {new Date(a.at).toLocaleTimeString("ru-RU")}.
                        {String(a.at % 1000).padStart(3, "0")}
                      </time>
                      {s.players.find((p: any) => p.id === a.id)?.name} ·{" "}
                      {a.accepted ? "первый" : "не принято"}
                    </p>
                  ))}
                </>
              )}
              {s.log.map((l: any, i: number) => (
                <p className="log" key={i}>
                  <time>{new Date(l.at).toLocaleTimeString("ru-RU")}</time>
                  {l.text}
                </p>
              ))}
            </div>
          )}
          {editor && (
            <Editor
              saveError={error}
              pack={s.pack}
              onClose={() => setEditor(false)}
              onSave={(p) => cmd("pack", p, () => setEditor(false))}
            />
          )}
        </main>
      )}
    </>
  );
}
const route = location.pathname;
createRoot(document.getElementById("root")!).render(
  route.startsWith("/admin") ? (
    <Admin />
  ) : route.startsWith("/screen") ? (
    <Screen />
  ) : (
    <Join />
  ),
);
