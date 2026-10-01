'use client'

// ─────────────────────────────────────────────
// /next · The adaptive contextual-discovery overlay
//
// One component tree, two layouts (CSS-driven):
//   · mobile  → single-column canvas, grids inline in each assistant turn
//   · desktop → conversation rail (left) + pinned results canvas (right)
//
// Live: calls /api/discover (semantic retrieval over the vision-enriched
// catalogue) with a scripted offline fallback. Local state (no Zustand).
// The desktop canvas carries the re-rank diff choreography (leave / stay /
// enter) — the product's hero motion. Reduced-motion has a complete path.
//
// This is the Intently DISCOVERY surface only — not a storefront. Browse/cart/
// checkout belong to the host store (the Medusa storefront); here you describe a
// situation and get an explained shortlist, then "close" hands back to the store.
// One Intently skin (CSS custom properties under [data-intently-next]).
// ─────────────────────────────────────────────

import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { prefersReducedMotion } from '@/lib/motion'
import { emptySessionContext, type SessionContext } from '@/types'
import type { ConsultAnswer } from '@/lib/discovery/consult'
import {
  discoverFirst,
  formatPrice,
  SEEDS,
  type DiscoverTurn,
  type ExplainedResult,
  type ParsedChip,
  type TurnAsk,
} from './scripted'
import { liveDiscover } from './live'

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

// Where "close" returns to — the host store root. Plain origin root so it leaves
// the Intently zone: under the storefront proxy that's the store home; standalone
// it's the app root.
const HOST_STORE_URL = '/'

// Plugin mode: served under a basePath inside the host storefront. When embedded,
// "Add" writes to the host's SHARED Medusa cart (POST {BASE}/api/cart) — Intently
// keeps NO cart of its own. Standalone keeps a local demo cart.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH || ''
const EMBEDDED = BASE !== ''

// The host storefront's cart page (region-scoped). "Review cart in store" jumps
// straight here so checkout happens in the store, not in Intently.
const STORE_CART_URL = '/dk/cart'

interface CartLine { name: string; image: string; quantity: number; price: number }

type ThreadItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'ai'; id: string; turn: DiscoverTurn }

type CardFx = Record<string, 'enter' | 'leave' | 'stay'>

// Local fly-to-cart (isolated from the river's store-coupled helper).
function flyTo(source: HTMLElement, target: HTMLElement) {
  if (prefersReducedMotion()) return
  const from = source.getBoundingClientRect()
  const to = target.getBoundingClientRect()
  if (!from.width || !to.width) return
  const clone = source.cloneNode(true) as HTMLElement
  clone.classList.add('fly-clone')
  Object.assign(clone.style, {
    position: 'fixed', left: `${from.left}px`, top: `${from.top}px`,
    width: `${from.width}px`, height: `${from.height}px`, margin: '0',
    transform: 'translate(0,0) scale(1)', opacity: '1',
    transition: 'transform 560ms cubic-bezier(0.4,0,0.2,1), opacity 560ms ease-in',
    borderRadius: '14px',
  })
  document.body.appendChild(clone)
  void clone.offsetWidth
  const dx = (to.left + to.width / 2) - (from.left + from.width / 2)
  const dy = (to.top + to.height / 2) - (from.top + from.height / 2)
  const scale = Math.max(0.1, 26 / Math.max(from.width, from.height))
  clone.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`
  clone.style.opacity = '0'
  const done = () => { clone.removeEventListener('transitionend', done); clone.remove() }
  clone.addEventListener('transitionend', done)
  setTimeout(done, 800)
}

export function NextExperience({ publicDemo = false }: { publicDemo?: boolean } = {}) {
  const [thread, setThread] = useState<ThreadItem[]>([])
  const [thinking, setThinking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [genKey, setGenKey] = useState(0) // remounts the refine bar on start-over

  // Current discover turn drives the desktop canvas.
  const [current, setCurrent] = useState<DiscoverTurn | null>(null)
  const [display, setDisplay] = useState<ExplainedResult[]>([])
  const [cardFx, setCardFx] = useState<CardFx>({})
  const [whyReady, setWhyReady] = useState(true)
  const [removingChips, setRemovingChips] = useState<Set<string>>(new Set())
  const [session, setSession] = useState<SessionContext>(emptySessionContext())

  // Cart. `cart` is the visual "added this session" set (per-card "In cart" +
  // fly-to). `cartCount` is the authoritative badge (the host's shared Medusa
  // cart when embedded, local count standalone). `cartItems` backs the summary.
  const [cart, setCart] = useState<ExplainedResult[]>([])
  const [cartCount, setCartCount] = useState(0)
  const [cartOpen, setCartOpen] = useState(false)
  const [cartItems, setCartItems] = useState<CartLine[]>([])

  const threadRef = useRef<HTMLDivElement>(null)
  const cartRef = useRef<HTMLButtonElement>(null)
  // Anonymous analytics session (no identity, no PII): one id per browser
  // session + a turn counter. Sent with every discover call and cart add.
  const sidRef = useRef<string>('')
  const turnRef = useRef(0)
  if (!sidRef.current && typeof window !== 'undefined') {
    try {
      sidRef.current = sessionStorage.getItem('intently-sid')
        ?? (() => { const v = crypto.randomUUID(); sessionStorage.setItem('intently-sid', v); return v })()
    } catch { sidRef.current = 'anon' }
  }
  // Which product ids arrived via the companion ("complete the look") rail —
  // lets the cart event carry WHERE the add happened.
  const addOnIdsRef = useRef<Set<string>>(new Set())

  // The experience has started once anything is in the thread — including a
  // blocking consultation turn, which has no results yet (current stays null).
  const started = thread.length > 0 || thinking
  // Only the latest assistant turn keeps live consultation options — stale
  // questions in the scrollback shouldn't invite taps against a moved-on session.
  const lastAi = [...thread].reverse().find(
    (i): i is Extract<ThreadItem, { kind: 'ai' }> => i.kind === 'ai',
  )
  const lastAiId = lastAi?.id
  // A live BLOCKING ask (question, no results yet): the blind tailor's
  // consultation. The desktop canvas — otherwise empty at this moment —
  // renders it as the visual chooser (sketch tiles); the rail keeps the
  // prompt in the bubble and its own pills on mobile.
  const pendingAsk = lastAi && lastAi.turn.ask && lastAi.turn.results.length === 0
    ? lastAi.turn.ask
    : null

  // Keep the latest turn in view (click-to-follow; never past the answer).
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }, [thread, thinking])

  const pushUser = (text: string) =>
    setThread(t => [...t, { kind: 'user', id: `u${t.length}-${Date.now()}`, text }])
  const pushAi = (turn: DiscoverTurn) =>
    setThread(t => [...t, { kind: 'ai', id: `a${t.length}-${Date.now()}`, turn }])

  const revealWhy = useCallback(() => {
    setWhyReady(false)
    setTimeout(() => setWhyReady(true), prefersReducedMotion() ? 0 : 240)
  }, [])

  // ── One turn through discovery: first search, refinement, or a tapped
  //    consultation answer. `dropLabel` removes an excluded context chip from
  //    the resulting turn so it doesn't reappear. ──
  const runTurn = useCallback(async (
    raw: string,
    opts: { answer?: ConsultAnswer; dropLabel?: string } = {},
  ) => {
    const query = raw.trim()
    const prev = current
    if (!query || busy) return
    setBusy(true)
    pushUser(query)
    setThinking(true)
    // Cart context from this session's adds — the engine never re-offers a
    // carted piece, and the cart anchors follow-up turns ("cold evenings"
    // with a dress in the cart asks for the layer). NOTE: pre-existing host
    // store cart lines carry no product ids, so only session adds count.
    const cartContext = cart.map(c => ({
      id: c.product.id, category: c.product.category, name: c.product.name,
    }))
    let next: DiscoverTurn
    let nextSession = session
    try {
      turnRef.current += 1
      const [r] = await Promise.all([
        liveDiscover(query, session, opts.answer, cartContext, { sessionId: sidRef.current, turn: turnRef.current }),
        sleep(prefersReducedMotion() ? 0 : 650),
      ])
      next = r.turn; nextSession = r.session
    } catch {
      next = discoverFirst(query) // never dead-end
    }
    addOnIdsRef.current = new Set((next.addOns ?? []).flatMap(g => g.items.map(i => i.product.id)))
    setThinking(false)
    setSession(nextSession)

    // Blocking consultation turn — the tailor asks before offering. The canvas
    // stays as it is (hint, or the previous shortlist); the thread carries it.
    if (next.ask && next.results.length === 0) {
      pushAi(next)
      setBusy(false)
      return
    }

    if (prev && next.results.length > 0) {
      // Re-rank diff from the previous vs new result ids.
      const prevIds = prev.results.map(p => p.product.id)
      const nextIds = next.results.map(p => p.product.id)
      const added = nextIds.filter(id => !prevIds.includes(id))
      const removed = prevIds.filter(id => !nextIds.includes(id))
      const kept = nextIds.filter(id => prevIds.includes(id))
      next = { ...next, diff: { added, removed, kept }, summary: `Swapped ${Math.max(added.length, removed.length)} · kept ${kept.length}` }
    }
    if (opts.dropLabel) next = { ...next, chips: next.chips.filter(c => c.label !== opts.dropLabel) }
    pushAi(next)

    if (next.noMatch) { setCurrent(next); setDisplay([]); setCardFx({}); setBusy(false); return }

    if (!prev || prefersReducedMotion() || !next.diff) {
      // First reveal (also the reveal AFTER a consultation): cards enter fresh.
      setCurrent(next)
      setDisplay(next.results)
      const fx: CardFx = {}
      if (!prev && !prefersReducedMotion()) next.results.forEach(r => { fx[r.product.id] = 'enter' })
      setCardFx(fx)
      revealWhy()
      if (!prev && !prefersReducedMotion()) setTimeout(() => setCardFx({}), 1000)
      setBusy(false)
      return
    }

    // Phase A — leaving cards fade + contract (canvas stays put, no scroll).
    setDisplay(prev.results)
    setCardFx(Object.fromEntries(next.diff.removed.map(id => [id, 'leave'])) as CardFx)
    await sleep(320)
    // Phase B — swap; new cards rise, kept cards settle.
    setCurrent(next)
    setDisplay(next.results)
    const fx: CardFx = {}
    next.diff.added.forEach(id => { fx[id] = 'enter' })
    next.diff.kept.forEach(id => { fx[id] = 'stay' })
    setCardFx(fx)
    revealWhy()
    await sleep(1000)
    setCardFx({})
    setBusy(false)
  }, [current, busy, session, cart, revealWhy])

  // Kept for the ?demo deep link and the invitation seeds.
  const runFirst = runTurn

  const onSubmit = (value: string) => runTurn(value)
  const onSeed = (seed: string) => runTurn(seed)
  const onRefineChip = (query: string) => runTurn(query)

  // A tapped consultation option: label becomes the shopper's reply; the
  // structured answer applies the option's patch server-side (no parsing).
  const onAnswer = (ask: TurnAsk, option: { id: string; label: string }) =>
    runTurn(option.label, { answer: { questionId: ask.id, optionId: option.id } })

  // Removing a parsed chip = an exclusion → refine, dropping that chip.
  const onRemoveChip = (chip: ParsedChip) => {
    if (busy) return
    setRemovingChips(s => new Set(s).add(chip.id))
    setTimeout(() => {
      setRemovingChips(s => { const n = new Set(s); n.delete(chip.id); return n })
      runTurn(`nothing ${chip.label}`, { dropLabel: chip.label })
    }, prefersReducedMotion() ? 0 : 240)
  }

  const addToCart = useCallback((res: ExplainedResult, imgEl: HTMLElement | null) => {
    // Optimistic, instant feedback (fly-to + per-card "In cart") regardless of mode.
    let already = false
    setCart(c => { already = c.some(x => x.product.id === res.product.id); return already ? c : [...c, res] })
    if (already) return
    if (imgEl && cartRef.current) flyTo(imgEl, cartRef.current)
    const btn = cartRef.current
    if (btn) { btn.setAttribute('data-pulse', 'true'); setTimeout(() => btn.removeAttribute('data-pulse'), 400) }

    // Analytics: the add-to-cart signal, in BOTH modes (fire-and-forget).
    void fetch(`${BASE}/api/analytics/track`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'cart', sessionId: sidRef.current, productId: res.product.id,
        title: res.product.name,
        surface: addOnIdsRef.current.has(res.product.id) ? 'companion' : 'reveal',
      }),
    }).catch(() => {})

    if (EMBEDDED && res.product.variantId) {
      // Plugin: add to the host storefront's SHARED Medusa cart; the badge then
      // mirrors the store's real count. No Intently cart of its own.
      void fetch(`${BASE}/api/cart`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ variantId: res.product.variantId }),
      })
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (d && typeof d.count === 'number') setCartCount(d.count) })
        .catch(() => {})
    } else {
      setCartCount(c => c + 1) // standalone local cart
    }
  }, [])

  // Open the cart summary. Embedded → read the host's shared Medusa cart;
  // standalone → the items added this session.
  const openCart = useCallback(() => {
    setCartOpen(true)
    if (EMBEDDED) {
      fetch(`${BASE}/api/cart`)
        .then(r => (r.ok ? r.json() : null))
        .then(d => { if (d) { setCartCount(d.count); setCartItems(d.items ?? []) } })
        .catch(() => {})
    } else {
      setCartItems(cart.map(c => ({ name: c.product.name, image: c.product.image, quantity: 1, price: c.product.price })))
    }
  }, [cart])

  const goToStoreCart = () => { if (typeof window !== 'undefined') window.location.assign(STORE_CART_URL) }

  const startOver = () => {
    setThread([]); setCurrent(null); setDisplay([]); setCardFx({})
    setThinking(false); setBusy(false); setCart([]); setCartOpen(false)
    setGenKey(k => k + 1)
    // Embedded: the host store cart persists (it's the store's, not ours) — keep
    // its count. Standalone: clear the local cart.
    if (!EMBEDDED) setCartCount(0)
  }

  // "Close" hands back to the host store (leaves the Intently discovery zone).
  const close = () => { if (typeof window !== 'undefined') window.location.assign(HOST_STORE_URL) }

  // Dev deep-link for screenshots: ?demo runs a REAL discovery for SEEDS[0]
  // (or ?q=…). No effect otherwise.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const demo = params.get('demo')
    if (!demo) return
    if (demo !== 'invite') runFirst(params.get('q') || SEEDS[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Embedded: seed the badge from the host store's existing shared cart so a
  // returning shopper sees what's already there.
  useEffect(() => {
    if (!EMBEDDED) return
    fetch(`${BASE}/api/cart`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (d && typeof d.count === 'number') setCartCount(d.count) })
      .catch(() => {})
  }, [])

  return (
    <div data-intently-next>
      <div className="nx-scrim nx-scrim--page">
          <div className="nx-overlay" role="region" aria-label="Intently discovery">
            <header className="nx-header">
              <span className="nx-wordmark"><span className="nx-wordmark__dot" />Intently</span>
              <div className="nx-header__spacer" />
              {started && <button className="nx-startover" onClick={startOver}>Start over</button>}
              <button
                ref={cartRef}
                className="nx-cart"
                onClick={openCart}
                aria-label={`Cart, ${cartCount} item${cartCount === 1 ? '' : 's'}`}
              >
                <CartIcon />
                <span>Cart</span>
                {cartCount > 0 && <span className="nx-cart__count">{cartCount}</span>}
              </button>
              <button className="nx-iconbtn" onClick={close} aria-label="Close"><X /></button>
            </header>

            {publicDemo && <VisitorWelcome onTry={onSubmit} disabled={busy} started={started} />}

            {!started ? (
              <Landing onSeed={onSeed} onSubmit={onSubmit} disabled={busy} />
            ) : (
            <div className="nx-body">
              <div className="nx-rail">
                <div className="nx-thread" ref={threadRef}>
                  {thread.map(item =>
                    item.kind === 'user' ? (
                      <div key={item.id} className="nx-turn nx-turn--user">
                        <div className="nx-bubble nx-bubble--user">{item.text}</div>
                      </div>
                    ) : (
                      <AiTurn
                        key={item.id}
                        turn={item.turn}
                        isLatest={item.id === lastAiId}
                        busy={busy}
                        onAnswer={onAnswer}
                        removingChips={removingChips}
                        onRemoveChip={onRemoveChip}
                        onAdd={addToCart}
                        cart={cart}
                      />
                    ),
                  )}

                  {thinking && (
                    <div className="nx-turn">
                      <div className="nx-thinking">
                        <span className="nx-thinking__label">
                          {started ? 'Assessing your situation' : 'Reading your situation'}
                        </span>
                        <span className="nx-dots"><i className="nx-dot" /><i className="nx-dot" /><i className="nx-dot" /></span>
                      </div>
                    </div>
                  )}
                </div>

                <RefineBar
                  key={genKey}
                  started={started}
                  refineChips={current?.refineChips ?? []}
                  onSubmit={onSubmit}
                  onChip={onRefineChip}
                  disabled={busy}
                />
              </div>

              <div className={`nx-canvas${!current && !pendingAsk ? ' nx-canvas--empty' : ''}`}>
                {pendingAsk && (
                  <VisualAsk ask={pendingAsk} busy={busy} onAnswer={onAnswer} />
                )}
                {!current && !pendingAsk && (
                  <div className="nx-canvas__hint">
                    <div className="nx-canvas__hinticon"><Compass /></div>
                    Your curated few will appear here — each with a reason it fits.
                  </div>
                )}
                {!pendingAsk && current?.noMatch && (
                  <div className="nx-canvas--empty">
                    <div className="nx-canvas__hint">No confident match yet — try one of the suggestions on the left.</div>
                  </div>
                )}
                {!pendingAsk && current && !current.noMatch && (
                  <>
                    <div className="nx-canvas__head">
                      <h2 className="nx-canvas__title">Your curated few</h2>
                      {current.diff ? (
                        <span className="nx-diffbanner">{current.summary}</span>
                      ) : (
                        <span className="nx-canvas__count">{display.length} pieces, explained</span>
                      )}
                    </div>
                    <div className="nx-grid">
                      {display.map((res, i) => (
                        <ExplainedCard
                          key={res.product.id}
                          res={res}
                          index={i}
                          fx={cardFx[res.product.id]}
                          whyReady={whyReady}
                          inCart={cart.some(c => c.product.id === res.product.id)}
                          onAdd={addToCart}
                        />
                      ))}
                    </div>

                    {/* Outfit completion — "complete the look" groups. The
                        lead line carries the reason; Add goes to the same
                        shared cart as the primary cards. */}
                    {current.addOns?.map(group => (
                      <div key={group.slotId} className="nx-addons">
                        <p className="nx-addons__lead">{group.lead}</p>
                        <div className="nx-grid nx-grid--addons">
                          {group.items.map((res, i) => (
                            <ExplainedCard
                              key={res.product.id}
                              res={res}
                              index={i}
                              whyReady
                              inCart={cart.some(c => c.product.id === res.product.id)}
                              onAdd={addToCart}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
            )}

            {cartOpen && (
              <div className="nx-celebrate" onClick={e => { if (e.target === e.currentTarget) setCartOpen(false) }}>
                <div className="nx-cartpanel">
                  <div className="nx-cartpanel__head">
                    <h3 className="nx-cartpanel__title">Your cart{cartCount > 0 ? ` · ${cartCount}` : ''}</h3>
                    <button className="nx-iconbtn" onClick={() => setCartOpen(false)} aria-label="Close"><X /></button>
                  </div>

                  {cartItems.length === 0 ? (
                    <p className="nx-cartpanel__empty">Your cart is empty — add something you discovered.</p>
                  ) : (
                    <>
                      <ul className="nx-cartlist">
                        {cartItems.map((it, i) => (
                          <li key={i} className="nx-cartrow">
                            {it.image
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img className="nx-cartrow__img" src={it.image} alt="" />
                              : <div className="nx-cartrow__img" />}
                            <div className="nx-cartrow__body">
                              <div className="nx-cartrow__name">{it.name}</div>
                              {it.quantity > 1 && <div className="nx-cartrow__meta">Qty {it.quantity}</div>}
                            </div>
                            <div className="nx-cartrow__price">{formatPrice(it.price * it.quantity)}</div>
                          </li>
                        ))}
                      </ul>
                      <div className="nx-cartpanel__total">
                        <span>Total</span>
                        <span>{formatPrice(cartItems.reduce((s, it) => s + it.price * it.quantity, 0))}</span>
                      </div>
                    </>
                  )}

                  <div className="nx-celebrate__actions">
                    {EMBEDDED && (
                      <button className="nx-celebrate__btn" onClick={goToStoreCart}>Review cart in store →</button>
                    )}
                    <button className={`nx-celebrate__btn${EMBEDDED ? ' nx-celebrate__btn--ghost' : ''}`} onClick={() => setCartOpen(false)}>
                      Keep discovering
                    </button>
                  </div>
                  <p className="nx-cartpanel__note">Checkout happens in the store — Intently just helps you find things.</p>
                </div>
              </div>
            )}
          </div>
      </div>
    </div>
  )
}

// ── The visual ask — a blocking consultation on the desktop canvas ──
// The blind tailor's this-or-that: while the tailor is still asking (no
// results yet), the otherwise-empty canvas renders the question as large,
// sketch-aided tiles. Audience and build get tailor's line sketches — the
// sketch depicts the person (fast to self-identify at a glance), while the
// label speaks about the CLOTHES ("easy through the middle"), which is what
// the tap sends, what the chip says, and how a tailor actually talks.
// Tiles go through the exact same answer path as the rail pills; typing in
// the bar below always stays open.

const SKETCH_HEAD = <circle cx="28" cy="9" r="5.5" />

const SKETCHES: Record<string, React.ReactNode> = {
  // Who will be wearing it — dress form / suit form / both, side by side.
  'audience:her': (
    <>
      {SKETCH_HEAD}
      <path d="M22 18 H34 L36 30 L44 60 H12 L20 30 Z" />
    </>
  ),
  'audience:him': (
    <>
      {SKETCH_HEAD}
      <path d="M17 18 H39 L37 42 H19 Z" />
      <path d="M24 42 V64 M32 42 V64" />
    </>
  ),
  'audience:either': (
    <>
      <circle cx="17" cy="24" r="4" />
      <path d="M13 31 H21 L25 52 H9 Z" />
      <circle cx="39" cy="24" r="4" />
      <path d="M35 31 H43 L42 45 H36 Z" />
      <path d="M38 45 V52 M41 45 V52" />
    </>
  ),
  // How should it sit — four builds, drawn kindly: trim / broad through the
  // shoulders / easy at the middle / generous all through.
  'build:trim': (
    <>
      {SKETCH_HEAD}
      <path d="M22 18 H34 C35 34 35 50 34 64 H22 C21 50 21 34 22 18 Z" />
    </>
  ),
  'build:shoulders': (
    <>
      {SKETCH_HEAD}
      <path d="M15 18 H41 C39 32 35 44 34 64 H22 C21 44 17 32 15 18 Z" />
    </>
  ),
  'build:middle': (
    <>
      {SKETCH_HEAD}
      <path d="M22 18 H34 C35 28 41 38 40 48 C39 58 36 64 34 64 H22 C20 64 17 58 16 48 C15 38 21 28 22 18 Z" />
    </>
  ),
  'build:generous': (
    <>
      {SKETCH_HEAD}
      <path d="M20 18 H36 C41 30 43 46 39 64 H17 C13 46 15 30 20 18 Z" />
    </>
  ),
}

function VisualAsk({ ask, busy, onAnswer }: {
  ask: TurnAsk
  busy: boolean
  onAnswer: (ask: TurnAsk, option: { id: string; label: string }) => void
}) {
  return (
    <div className="nx-vask" role="group" aria-label="Answer options">
      <div className="nx-invite__eyebrow">A quick question</div>
      <h2 className="nx-vask__prompt">{ask.prompt}</h2>
      <div className="nx-vask__tiles">
        {ask.options.map((o, i) => {
          const sketch = SKETCHES[`${ask.id}:${o.id}`]
          return (
            <button
              key={o.id}
              className={`nx-vask__tile${sketch ? '' : ' nx-vask__tile--text'}`}
              style={{ animationDelay: `${i * 70}ms` }}
              onClick={() => onAnswer(ask, o)}
              disabled={busy}
            >
              {sketch && (
                <svg className="nx-vask__art" viewBox="0 0 56 72" aria-hidden="true">
                  {sketch}
                </svg>
              )}
              <span className="nx-vask__label">{o.label}</span>
            </button>
          )
        })}
      </div>
      <p className="nx-vask__hint">or answer in your own words below — either works</p>
    </div>
  )
}

// ── Landing (pre-search) · Concept B "The Living Preview" ──
// Editorial invitation on the left + a calm, dimmed, cross-fading example of
// the payoff on the right — so the shopper sees what comes back (explained, not
// endless) before typing a word. Replaces the empty results canvas that read as
// a void. The post-search rail+canvas layout is untouched.
// Public demo only (INTENTLY_PUBLIC_DEMO): a slim strip under the header that
// tells a first-time visitor what they are looking at and what to try. Dismissal is kept
// for the browser session. This is orientation for a visitor, not the tailor's
// voice — it never appears in a private or embedded deployment.
const WELCOME_DISMISSED_KEY = 'intently:welcome-dismissed'
const WELCOME_TRY = 'A black dress for a party, it might get cold later'

const noopSubscribe = () => () => {}
function readWelcomeDismissed(): boolean {
  try { return sessionStorage.getItem(WELCOME_DISMISSED_KEY) === '1' } catch { return false }
}

function VisitorWelcome({ onTry, disabled, started }: {
  onTry: (s: string) => void
  disabled: boolean
  started: boolean
}) {
  // sessionStorage is an external store: the server snapshot says "dismissed"
  // (render nothing), and the client corrects it after hydration — no mismatch.
  const dismissedEarlier = useSyncExternalStore(noopSubscribe, readWelcomeDismissed, () => true)
  const [closed, setClosed] = useState(false)
  if (dismissedEarlier || closed) return null
  const dismiss = () => {
    try { sessionStorage.setItem(WELCOME_DISMISSED_KEY, '1') } catch { /* private mode */ }
    setClosed(true)
  }
  return (
    <aside className="nx-welcome" aria-label="About this demo">
      <span className="nx-welcome__tag">Public demo</span>
      <p className="nx-welcome__body">
        A working demo by Ilmari Vuorenmaa: the engine decides, a capped language model only words it.
      </p>
      {!started && (
        <button className="nx-welcome__try" onClick={() => onTry(WELCOME_TRY)} disabled={disabled} title={WELCOME_TRY}>
          Try a brief
        </button>
      )}
      <Link className="nx-welcome__link" href="/admin/enrichment/studio">
        Open the Studio →
      </Link>
      <button className="nx-welcome__close" onClick={dismiss} aria-label="Dismiss">×</button>
      <p className="nx-welcome__fine">
        Intently is a prototype, so results may vary — thank you for trying it.
        What you type is logged anonymously to improve the demo; there are no accounts, and other visitors never see it.
      </p>
    </aside>
  )
}

function Landing({ onSeed, onSubmit, disabled }: {
  onSeed: (s: string) => void
  onSubmit: (v: string) => void
  disabled: boolean
}) {
  return (
    <div className="nx-landing">
      <section className="nx-landing__left">
        <div className="nx-invite__eyebrow">Shop by situation</div>
        <h1 className="nx-landing__title">Tell me the moment.<br />I&rsquo;ll bring the few that fit.</h1>
        <p className="nx-landing__sub">
          Describe where you&rsquo;re headed — not a category. You&rsquo;ll get a short,
          explained shortlist, and you can steer it as we go.
        </p>
        <LandingInput onSubmit={onSubmit} disabled={disabled} />
        <div className="nx-landing__seeds">
          {SEEDS.map(s => (
            <button key={s} className="nx-seed nx-seed--inline" onClick={() => onSeed(s)}>
              <span className="nx-seed__quote">“</span>{s}
            </button>
          ))}
        </div>
        <p className="nx-landing__promise"><b>A curated few — each with the reason it fits.</b> Not a wall of results to scroll.</p>
      </section>
      <LivingPreview />
    </div>
  )
}

// A's rotating placeholder, ported in: the empty input cycles through real
// situations (fashion + outdoor; occasion, function, gift) so even a blank field
// teaches what to type and shows Intently's range. Cycles while empty, stops the
// instant the shopper types, holds still under reduced motion.
const LANDING_PLACEHOLDERS = [
  'A linen shirt for a warm coastal wedding…',
  "Sturdy track pants that don't look like gym clothes…",
  'Something for my dad who hikes in autumn…',
  'A first proper winter coat for commuting…',
  'An outfit for a summer garden party…',
]

// Owns its own input value so typing never re-renders the overlay (same rule as
// RefineBar). Submits through the single runTurn contract.
function LandingInput({ onSubmit, disabled }: { onSubmit: (v: string) => void; disabled: boolean }) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // Cycle the placeholder via the DOM ref so it never triggers a re-render.
  useEffect(() => {
    if (prefersReducedMotion()) return
    const el = inputRef.current
    if (!el) return
    let i = 0
    const id = setInterval(() => {
      if (el.value) return // never fight a shopper who's already typing
      el.style.opacity = '0'
      window.setTimeout(() => {
        i = (i + 1) % LANDING_PLACEHOLDERS.length
        el.placeholder = LANDING_PLACEHOLDERS[i]
        el.style.opacity = '1'
      }, 380)
    }, 3200)
    return () => clearInterval(id)
  }, [])
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    if (!v) return
    setValue('')
    onSubmit(v)
  }
  return (
    <form className="nx-landing__inputrow" onSubmit={submit}>
      <input
        ref={inputRef}
        autoFocus
        className="nx-landing__input"
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={LANDING_PLACEHOLDERS[0]}
        aria-label="Describe what you are shopping for"
      />
      <button className="nx-send" type="submit" disabled={disabled || !value.trim()} aria-label="Discover">
        <Arrow />
      </button>
    </form>
  )
}

// The living preview: real catalogue pieces with their real why-this lines,
// cross-fading on a calm cycle. Tagged "Example" + dimmed so it never reads as
// the shopper's own results, and aria-hidden (decorative). Reduced motion → a
// single static example, no cycling (detected at call time).
const PREVIEW_EXAMPLES = [
  {
    line: 'Five pieces for a weekend hike in the hills — a light kit that layers.',
    chips: ['day hiking', 'active', 'layerable'],
    brand: 'Norse Trail',
    name: 'Hooded Softshell Jacket',
    price: 5900,
    image: '/catalog/282832017.webp',
    why: 'Wind- and shower-proof shell — the piece that earns its place on a changeable hill day.',
  },
  {
    line: 'Five easy pieces for a relaxed summer weekend in the city.',
    chips: ['summer', 'relaxed', 'city weekend'],
    brand: 'Everyday',
    name: 'Striped Cotton Tank',
    price: 1300,
    image: '/catalog/218354045.webp',
    why: 'An easy striped tank that does the whole weekend with a skirt or under a shirt.',
  },
]

function LivingPreview() {
  const [idx, setIdx] = useState(0)
  useEffect(() => {
    if (prefersReducedMotion()) return // no cycling under reduced motion
    const id = setInterval(() => setIdx(i => (i + 1) % PREVIEW_EXAMPLES.length), 4200)
    return () => clearInterval(id)
  }, [])
  return (
    <aside className="nx-preview" aria-hidden="true">
      <div className="nx-preview__cap"><span className="nx-preview__pulse" />A glimpse of what comes back — explained, not endless</div>
      <div className="nx-preview__stage">
        {PREVIEW_EXAMPLES.map((ex, i) => (
          <div key={ex.name} className={`nx-preview__demo${i === idx ? ' is-active' : ''}`}>
            <span className="nx-preview__tag">Example</span>
            <div className="nx-bubble nx-bubble--ai nx-preview__line">{ex.line}</div>
            <div className="nx-chips nx-preview__chips">
              {ex.chips.map(c => <span key={c} className="nx-chip nx-chip--static">{c}</span>)}
            </div>
            <article className="nx-card nx-card--best nx-preview__card">
              <div className="nx-card__imgwrap">
                <span className="nx-card__badge">Best match</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="nx-card__img" src={ex.image} alt={ex.name} loading="lazy" />
              </div>
              <div className="nx-card__body">
                <div className="nx-card__brand">{ex.brand}</div>
                <h3 className="nx-card__name">{ex.name}</h3>
                <p className="nx-card__why">{ex.why}</p>
                <div className="nx-card__foot">
                  <span className="nx-card__price">{formatPrice(ex.price)}</span>
                  <span className="nx-add nx-add--demo">Add</span>
                </div>
              </div>
            </article>
          </div>
        ))}
      </div>
    </aside>
  )
}

// ── An assistant turn in the thread ──
function AiTurn({
  turn, isLatest, busy, onAnswer, removingChips, onRemoveChip, onAdd, cart,
}: {
  turn: DiscoverTurn
  isLatest: boolean
  busy: boolean
  onAnswer: (ask: TurnAsk, option: { id: string; label: string }) => void
  removingChips: Set<string>
  onRemoveChip: (c: ParsedChip) => void
  onAdd: (r: ExplainedResult, el: HTMLElement | null) => void
  cart: ExplainedResult[]
}) {
  return (
    <div className="nx-turn">
      <div className="nx-bubble nx-bubble--ai">{turn.message}</div>

      {turn.chips.length > 0 && (
        <div className="nx-chips" aria-label="Understood context">
          {turn.chips.map(c => (
            <span key={c.id} className={`nx-chip${removingChips.has(c.id) ? ' nx-chip--removing' : ''}`}>
              {c.label}
              <button className="nx-chip__x" aria-label={`Remove ${c.label}`} onClick={() => onRemoveChip(c)}>×</button>
            </span>
          ))}
        </div>
      )}

      {turn.followUp && <div className="nx-chips__label" style={{ marginTop: 6 }}>{turn.followUp.question}</div>}

      {/* The tailor's consultation options — tappable A/B; typing stays open.
          Blocking ask: prompt lives in the bubble, pills only. Sharpening
          (results present): quiet prompt lead-in + pills. */}
      {turn.ask && isLatest && (
        // A blocking ask (no results) also renders as the visual chooser in
        // the desktop canvas — these rail pills then hide ≥860px (CSS) so the
        // question isn't answered from two places at once. Mobile keeps them.
        <div
          className={`nx-ask${turn.results.length === 0 ? ' nx-ask--blocking' : ''}`}
          role="group"
          aria-label="Answer options"
        >
          {turn.results.length > 0 && (
            <div className="nx-chips__label" style={{ marginTop: 6 }}>{turn.ask.prompt}</div>
          )}
          <div className="nx-refine__chips" style={{ marginTop: 8 }}>
            {turn.ask.options.map(o => (
              <button key={o.id} className="nx-refchip" onClick={() => onAnswer(turn.ask!, o)} disabled={busy}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Mobile: each turn carries its own grid inline (CSS hides on desktop) */}
      {turn.results.length > 0 && (
        <div className="nx-inlinegrid">
          <div className="nx-grid">
            {turn.results.map((res, i) => (
              <ExplainedCard
                key={res.product.id}
                res={res}
                index={i}
                fx="enter"
                whyReady
                inCart={cart.some(c => c.product.id === res.product.id)}
                onAdd={onAdd}
              />
            ))}
          </div>
          {turn.addOns?.map(group => (
            <div key={group.slotId} className="nx-addons">
              <p className="nx-addons__lead">{group.lead}</p>
              <div className="nx-grid nx-grid--addons">
                {group.items.map((res, i) => (
                  <ExplainedCard
                    key={res.product.id}
                    res={res}
                    index={i}
                    whyReady
                    inCart={cart.some(c => c.product.id === res.product.id)}
                    onAdd={onAdd}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Explained product card (the why-this line is the hero) ──
const ExplainedCard = memo(function ExplainedCard({
  res, index, fx, whyReady, inCart, onAdd,
}: {
  res: ExplainedResult
  index: number
  fx?: 'enter' | 'leave' | 'stay'
  whyReady: boolean
  inCart: boolean
  onAdd: (r: ExplainedResult, el: HTMLElement | null) => void
}) {
  const imgRef = useRef<HTMLDivElement>(null)
  const fxClass =
    fx === 'enter' ? ' nx-card--entering' : fx === 'leave' ? ' nx-card--leaving' : fx === 'stay' ? ' nx-card--staying' : ''
  return (
    <article className={`nx-card${res.isBest ? ' nx-card--best' : ''}${fxClass}`}>
      <div className="nx-card__imgwrap" ref={imgRef}>
        {res.isBest && <span className="nx-card__badge">Best match</span>}
        {fx === 'enter' && !res.isBest && <span className="nx-card__new">New</span>}
        {/* plain img: next/image optimizer is finicky with webp under basePath */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="nx-card__img" src={res.product.image} alt={res.product.name} loading="lazy" />
      </div>
      <div className="nx-card__body">
        <div className="nx-card__brand">{res.product.brand}</div>
        <h3 className="nx-card__name">{res.product.name}</h3>
        <p
          className={`nx-card__why${whyReady ? '' : ' nx-card__why--streaming'}`}
          style={{ transitionDelay: `${index * 70}ms` }}
        >
          {res.why}
        </p>
        <div className="nx-card__foot">
          <span className="nx-card__price">{formatPrice(res.product.price)}</span>
          <button
            className={`nx-add${inCart ? ' nx-add--in' : ''}`}
            onClick={() => onAdd(res, imgRef.current)}
            disabled={inCart}
          >
            {inCart ? 'In cart' : 'Add'}
          </button>
        </div>
      </div>
    </article>
  )
})

// ── Refine bar — owns its own input value so typing never re-renders the
//    overlay / product grid. ──
function RefineBar({
  started, refineChips, onSubmit, onChip, disabled,
}: {
  started: boolean
  refineChips: { id: string; label: string; query: string }[]
  onSubmit: (value: string) => void
  onChip: (q: string) => void
  disabled: boolean
}) {
  const [value, setValue] = useState('')
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const v = value.trim()
    if (!v) return
    setValue('')
    onSubmit(v)
  }
  return (
    <div className="nx-refine">
      {started && refineChips.length > 0 && (
        <div className="nx-refine__chips">
          {refineChips.map(c => (
            <button key={c.id} className="nx-refchip" onClick={() => onChip(c.query)} disabled={disabled}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      <form className="nx-inputrow" onSubmit={submit}>
        <input
          autoFocus
          className="nx-input"
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder={started ? 'Refine — e.g. “warmer for the evenings”' : 'Describe what you’re shopping for…'}
          aria-label={started ? 'Refine your results' : 'Describe what you are shopping for'}
        />
        <button className="nx-send" type="submit" disabled={disabled || !value.trim()} aria-label="Send">
          <Arrow />
        </button>
      </form>
    </div>
  )
}

// ── Inline icons ──
function Compass() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5 5-2z" />
    </svg>
  )
}
function CartIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 7h12l-1 13H7L6 7zM9 7a3 3 0 0 1 6 0" />
    </svg>
  )
}
function X() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}
function Arrow() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  )
}
