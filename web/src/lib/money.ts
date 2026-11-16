/** "€13.29" from 1329 cents. The amount and currency always come from the API. */
export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-IE', { style: 'currency', currency }).format(cents / 100)
}

/** "25 Feb 2022" from "2022-02-25". */
export function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${isoDate}T00:00:00Z`),
  )
}
