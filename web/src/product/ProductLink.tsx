import type { ComponentProps } from 'react'
import { Link } from 'react-router'
import type { ProductSummary } from '../lib/catalog'
import { useProductLink } from './openProduct'

/**
 * A link to a product page that opens it with the movement in
 * openProduct.ts: the picture inside it marked `data-cover` glides into the
 * page's cover (or the one `pictureOf` finds, when it is elsewhere).
 * Otherwise an ordinary <Link>, and one where the movement cannot be shown.
 */
export function ProductLink({
  product,
  pictureOf,
  ...props
}: Omit<ComponentProps<typeof Link>, 'to'> & { product: Pick<ProductSummary, 'slug' | 'cover_image_url'>; pictureOf?: () => Element | null }) {
  const movement = useProductLink(product, pictureOf)

  return <Link {...props} to={`/product/${product.slug}`} {...movement} />
}
