// ─────────────────────────────────────────────
// flyToCart — animate a cloned product image from
// its current position to the cart button.
//
// FLIP technique: capture source rect, clone the
// node into document.body at that rect, then
// transition transform + opacity toward the cart
// target. The clone cleans itself up on
// transitionend. Uses inline styles so no Tailwind
// class purging concerns.
// ─────────────────────────────────────────────

import { prefersReducedMotion } from '@/lib/motion'

const DURATION_MS = 550
const CART_ID = 'cart-button'
const PULSE_ATTR = 'data-cart-pulse'

function pulseCartButton() {
  const cart = document.getElementById(CART_ID)
  if (!cart) return
  cart.setAttribute(PULSE_ATTR, 'true')
  setTimeout(() => cart.removeAttribute(PULSE_ATTR), 400)
}

export function flyToCart(source: HTMLElement) {
  if (typeof document === 'undefined') return

  const cart = document.getElementById(CART_ID)
  if (!cart) return

  // Reduced-motion users: skip the fly, just pulse.
  if (prefersReducedMotion()) {
    pulseCartButton()
    return
  }

  const fromRect = source.getBoundingClientRect()
  const toRect = cart.getBoundingClientRect()

  // Nothing to animate if either rect is zero-size (offscreen, display:none).
  if (!fromRect.width || !toRect.width) {
    pulseCartButton()
    return
  }

  // Clone the source. Using cloneNode(true) preserves inner image/content.
  const clone = source.cloneNode(true) as HTMLElement
  clone.classList.add('fly-clone')

  // Match the source rect exactly.
  Object.assign(clone.style, {
    position: 'fixed',
    left:   `${fromRect.left}px`,
    top:    `${fromRect.top}px`,
    width:  `${fromRect.width}px`,
    height: `${fromRect.height}px`,
    margin: '0',
    transform: 'translate(0, 0) scale(1)',
    opacity: '1',
    transition: `transform ${DURATION_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${DURATION_MS}ms ease-in`,
  })

  document.body.appendChild(clone)

  // Force a reflow so the browser picks up the initial state before applying the end state.
  void clone.offsetWidth

  const dx = (toRect.left + toRect.width  / 2) - (fromRect.left + fromRect.width  / 2)
  const dy = (toRect.top  + toRect.height / 2) - (fromRect.top  + fromRect.height / 2)
  // Scale so the clone's largest edge shrinks to ~cart icon size (~28px).
  const targetScale = Math.max(0.12, 28 / Math.max(fromRect.width, fromRect.height))

  clone.style.transform = `translate(${dx}px, ${dy}px) scale(${targetScale})`
  clone.style.opacity = '0'

  // Pulse the cart slightly before the clone arrives — feels like the bag reacts.
  setTimeout(pulseCartButton, DURATION_MS - 120)

  const cleanup = () => {
    clone.removeEventListener('transitionend', cleanup)
    clone.remove()
  }
  clone.addEventListener('transitionend', cleanup)
  // Safety net in case transitionend never fires.
  setTimeout(cleanup, DURATION_MS + 200)
}
