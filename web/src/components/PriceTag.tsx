import type { Money } from '../lib/catalog'
import { formatMoney } from '../lib/money'

interface Props {
  /** null means nothing can be bought: shown as "Sold out". */
  price: Money | null
  size?: 'card' | 'large'
  /** The small label above the amount, e.g. "From". */
  label?: string
  /** Which edge the lines sit against; right in a column of prices. */
  align?: 'left' | 'right'
}

/**
 * How a price is shown everywhere: the amount, and for a discounted offer the
 * struck-through original with the percentage saved. Every number comes
 * from the API; nothing is calculated here.
 */
export function PriceTag({ price, size = 'card', label, align = 'left' }: Props) {
  if (price === null) {
    return <p className={`font-extrabold text-muted ${size === 'large' ? 'text-2xl' : 'text-lg'}`}>Sold out</p>
  }

  const { amount_cents, currency, original_amount_cents, discount_percent } = price

  return (
    <div className={align === 'right' ? 'text-right' : ''}>
      <p className={`flex flex-wrap items-baseline gap-x-2 text-xs font-extrabold text-muted ${align === 'right' ? 'justify-end' : ''}`}>
        {label && <span>{label}</span>}
        {original_amount_cents !== null && (
          <>
            <s>
              <span className="sr-only">Was </span>
              {formatMoney(original_amount_cents, currency)}
            </s>
            <span className="text-deal">
              <span className="sr-only">, saving </span>-{discount_percent}%
            </span>
          </>
        )}
      </p>
      <p className={`font-black leading-tight ${size === 'large' ? 'text-4xl' : 'text-[22px]'}`}>
        {formatMoney(amount_cents, currency)}
      </p>
    </div>
  )
}
