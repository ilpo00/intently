// ─────────────────────────────────────────────
// Intently · Zustand Store
//
// All page state lives here. Intently is a single
// scrolling "river" — every section reads from and
// writes to this one store, no prop drilling.
//
// Phase-1 store is in-memory only (no account/Supabase
// layer — that's parked). Slices: conversation/session,
// style picker, cart, flow.
// ─────────────────────────────────────────────

import { create } from 'zustand'
import type {
  Message,
  StyleSignal,
  StyleProfile,
  StyleArchetype,
  Cart,
  CartItem,
  Asset,
  SessionContext,
  DiscoveryResult,
  IntentType,
  ConsultQuestion,
  CompanionSuggestion,
} from '@/types'
import { emptySessionContext } from '@/types'

// Dominant style = the most-loved archetype once the user has ≥3 love signals.
// Skips/nopes don't count. Returns undefined below the threshold so the picker
// keeps showing without triggering a "we know your style" handoff.
function deriveDominantStyle(signals: StyleSignal[]): StyleArchetype | undefined {
  const loves = signals.filter(s => s.signal === 'love')
  if (loves.length < 3) return undefined
  const counts: Partial<Record<StyleArchetype, number>> = {}
  for (const s of loves) counts[s.styleId] = (counts[s.styleId] ?? 0) + 1
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return sorted[0][0] as StyleArchetype
}

// ─── Conversation / session slice ─────────────

interface ConversationSlice {
  messages: Message[]
  // The structured context accumulated across turns — the real discovery
  // signal. Passed to the discovery engine alongside the current query.
  sessionContext: SessionContext
  // The tailor's open consultation question (ask-before-offer or the
  // non-blocking "sharpen it" beat). Rendered as tappable option pills under
  // the latest assistant message; cleared on any new submit.
  pendingQuestion: ConsultQuestion | null
  intent: IntentType          // coarse layout/analytics hint only
  isLoading: boolean          // true while the discovery engine is responding

  addMessage: (msg: Message) => void
  setPendingQuestion: (q: ConsultQuestion | null) => void
  /** Append a chunk to the LAST message if it's role=assistant (SSE streaming). */
  appendToLastAssistantMessage: (chunk: string) => void
  /** Replace the last assistant message's content wholesale (final SSE event). */
  replaceLastAssistantMessage: (content: string) => void
  setSessionContext: (ctx: SessionContext) => void
  setIntent: (intent: IntentType) => void
  setLoading: (v: boolean) => void
  resetConversation: () => void
}

// ─── Style picker slice (repurposed taste grid) ─

interface StyleSlice {
  styleProfile: StyleProfile
  // Session-scoped flag — flips true the moment the user actively touches a
  // style signal THIS session. Stays false through any restore so restored
  // data never auto-advances the river. (Persistence-restores-data invariant.)
  hasInteractedWithStyle: boolean

  addStyleSignal: (signal: StyleSignal) => void
  removeStyleSignal: (styleId: StyleArchetype) => void
  resetStyle: () => void
  clearStyleSelection: () => void
}

// ─── Cart slice ───────────────────────────────

interface CartSlice {
  cart: Cart
  isCartOpen: boolean

  // Cart actions consume Asset and operate on composite asset ids
  // (`product:1163`). Producers wrap a raw Product via productToAsset()
  // (src/lib/asset.ts) before calling.
  addToCart: (asset: Asset) => void
  addToCartSilent: (asset: Asset) => void
  removeFromCart: (assetId: string) => void
  updateQuantity: (assetId: string, qty: number) => void
  toggleGiftWrap: () => void
  setGiftNote: (assetId: string, note: string) => void
  openCart: () => void
  closeCart: () => void
  clearCart: () => void
  highlightedCartAssetId: string | null
  highlightCartAsset: (id: string | null) => void
}

// ─── Flow slice ───────────────────────────────
// NOTE: product detail is a floating overlay, not a river stop — selectAsset
// must NOT mutate activeSection (otherwise effects keyed on activeSection
// scroll the viewport away from what the user clicked).
export type PageSection = 'entry' | 'style' | 'discovery' | 'checkout'

interface FlowSlice {
  activeSection: PageSection
  // Re-ranked, explained discovery results for the current situation.
  results: DiscoveryResult[]
  // Outfit-completion groups ("complete the look") shown under the results.
  addOns: CompanionSuggestion[]
  selectedAsset: Asset | undefined
  // Whether the persistent prompt bar is active (user has submitted once).
  stickyActive: boolean
  // Suggested refinement chips shown under the prompt ("more formal?", "not floral").
  contextChips: string[]

  setActiveSection: (s: PageSection) => void
  setResults: (r: DiscoveryResult[]) => void
  setAddOns: (a: CompanionSuggestion[]) => void
  selectAsset: (a: Asset | null) => void
  setStickyActive: (v: boolean) => void
  setContextChips: (chips: string[]) => void
  /** Wipe discovery results WITHOUT changing activeSection. */
  clearDiscovery: () => void
}

// ─── Session-scope reset ──────────────────────
interface SessionSlice {
  /** Hard-reset every slice → clean entry-section state (post-checkout exit). */
  resetSession: () => void
  /** Wipe the visible river (messages, style, results, chips) back to entry,
   *  keeping the cart. Used when the user submits a fresh situation. */
  resetCurrentRiver: () => void
}

// ─── Combined store ───────────────────────────

type IntentlyStore = ConversationSlice & StyleSlice & CartSlice & FlowSlice & SessionSlice

// Bump quantity if the asset is already in cart, else append a new line.
function bumpOrAdd(items: CartItem[], asset: Asset): CartItem[] {
  const existing = items.find(i => i.asset.id === asset.id)
  if (existing) {
    return items.map(i =>
      i.asset.id === asset.id ? { ...i, quantity: i.quantity + 1 } : i,
    )
  }
  return [...items, { asset, quantity: 1 }]
}

export const useIntentlyStore = create<IntentlyStore>()((set) => ({

  // ── Conversation / session ────────────────

  messages: [],
  sessionContext: emptySessionContext(),
  pendingQuestion: null,
  intent: 'unknown',
  isLoading: false,

  addMessage: (msg) =>
    set(state => ({ messages: [...state.messages, msg] })),

  setPendingQuestion: (q) => set({ pendingQuestion: q }),

  appendToLastAssistantMessage: (chunk) =>
    set(state => {
      const last = state.messages[state.messages.length - 1]
      if (!last || last.role !== 'assistant') return state
      const updated = { ...last, content: last.content + chunk }
      return { messages: [...state.messages.slice(0, -1), updated] }
    }),

  replaceLastAssistantMessage: (content) =>
    set(state => {
      const last = state.messages[state.messages.length - 1]
      if (!last || last.role !== 'assistant') return state
      const updated = { ...last, content }
      return { messages: [...state.messages.slice(0, -1), updated] }
    }),

  setSessionContext: (ctx) => set({ sessionContext: ctx }),
  setIntent: (intent) => set({ intent }),
  setLoading: (v) => set({ isLoading: v }),

  resetConversation: () =>
    set({ messages: [], sessionContext: emptySessionContext(), pendingQuestion: null, intent: 'unknown' }),

  // ── Style picker ──────────────────────────

  styleProfile: { signals: [] },
  hasInteractedWithStyle: false,

  addStyleSignal: (signal) =>
    set(state => {
      // Replace any existing signal for the same style (allows re-voting).
      const other = state.styleProfile.signals.filter(s => s.styleId !== signal.styleId)
      const signals = [...other, signal]
      return {
        styleProfile: { signals, dominantStyle: deriveDominantStyle(signals) },
        hasInteractedWithStyle: true,
      }
    }),

  removeStyleSignal: (styleId) =>
    set(state => {
      const signals = state.styleProfile.signals.filter(s => s.styleId !== styleId)
      return {
        styleProfile: { signals, dominantStyle: deriveDominantStyle(signals) },
        hasInteractedWithStyle: true,
      }
    }),

  resetStyle: () => set({
    styleProfile: { signals: [] },
    hasInteractedWithStyle: false,
  }),

  clearStyleSelection: () => set({
    styleProfile: { signals: [] },
    // Keep hasInteractedWithStyle=true — the user is interacting right now and
    // chose to repick; flipping false would hide the picker.
  }),

  // ── Cart ──────────────────────────────────

  cart: { items: [], giftWrap: false },
  isCartOpen: false,

  addToCart: (asset) =>
    set(state => ({
      cart: { ...state.cart, items: bumpOrAdd(state.cart.items, asset) },
      isCartOpen: true,
    })),

  // Same mutation, does not auto-open the drawer (used by in-grid cards).
  addToCartSilent: (asset) =>
    set(state => ({
      cart: { ...state.cart, items: bumpOrAdd(state.cart.items, asset) },
    })),

  removeFromCart: (assetId) =>
    set(state => ({
      cart: { ...state.cart, items: state.cart.items.filter(i => i.asset.id !== assetId) },
    })),

  updateQuantity: (assetId, qty) =>
    set(state => ({
      cart: {
        ...state.cart,
        items: qty <= 0
          ? state.cart.items.filter(i => i.asset.id !== assetId)
          : state.cart.items.map(i =>
              i.asset.id === assetId ? { ...i, quantity: qty } : i,
            ),
      },
    })),

  toggleGiftWrap: () =>
    set(state => ({ cart: { ...state.cart, giftWrap: !state.cart.giftWrap } })),

  setGiftNote: (assetId, note) =>
    set(state => ({
      cart: {
        ...state.cart,
        items: state.cart.items.map(i =>
          i.asset.id === assetId ? { ...i, giftNote: note } : i,
        ),
      },
    })),

  openCart: () => set({ isCartOpen: true }),
  closeCart: () => set({ isCartOpen: false }),
  clearCart: () => set({ cart: { items: [], giftWrap: false }, isCartOpen: false }),
  highlightedCartAssetId: null,
  highlightCartAsset: (id) => set({ highlightedCartAssetId: id }),

  // ── Flow ──────────────────────────────────

  activeSection: 'entry',
  results: [],
  addOns: [],
  selectedAsset: undefined,
  stickyActive: false,
  contextChips: [],

  setActiveSection: (s) => set({ activeSection: s }),

  setResults: (results) => set({ results, activeSection: 'discovery' }),
  setAddOns: (addOns) => set({ addOns }),

  selectAsset: (asset) => set({ selectedAsset: asset ?? undefined }),

  setStickyActive: (v) => set({ stickyActive: v }),
  setContextChips: (chips) => set({ contextChips: chips }),

  clearDiscovery: () => set({ results: [], addOns: [] }),

  // ── Session-scope reset ───────────────────

  resetCurrentRiver: () => set({
    messages: [],
    sessionContext: emptySessionContext(),
    pendingQuestion: null,
    intent: 'unknown',
    styleProfile: { signals: [] },
    hasInteractedWithStyle: false,
    activeSection: 'entry',
    results: [],
    addOns: [],
    contextChips: [],
  }),

  resetSession: () => set({
    messages: [],
    sessionContext: emptySessionContext(),
    pendingQuestion: null,
    intent: 'unknown',
    isLoading: false,
    styleProfile: { signals: [] },
    hasInteractedWithStyle: false,
    cart: { items: [], giftWrap: false },
    isCartOpen: false,
    highlightedCartAssetId: null,
    stickyActive: false,
    contextChips: [],
    activeSection: 'entry',
    results: [],
    addOns: [],
    selectedAsset: undefined,
  }),
}))

// ─── Derived selectors (use these in components) ──

export const cartTotal = (store: IntentlyStore) =>
  store.cart.items.reduce((sum, item) => sum + item.asset.price * item.quantity, 0)

export const cartCount = (store: IntentlyStore) =>
  store.cart.items.reduce((sum, item) => sum + item.quantity, 0)
