import type { CSSProperties } from "react";

export type YodevProduct = "mail" | "ads" | "spend";
export const symbolPath = "M3 4H10L16 12L22 4H30L13 29H5L12 19L3 8Z";
export function BrandSymbol({ className = "y-symbol", style }: { className?: string; style?: CSSProperties }) {
  return <svg className={className} style={style} viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d={symbolPath} /></svg>;
}
export function YodevBrand({ product, className = "" }: { product?: YodevProduct; className?: string }) {
  const name = product ? product[0].toUpperCase() + product.slice(1) : null;
  return <span className={`y-brand ${className}`} data-product={product}><BrandSymbol /><span>yodev{name && <span className="y-product-name"> {name}</span>}</span></span>;
}
export function ProductLinks({ locale = "fr", current }: { locale?: string; current?: YodevProduct }) {
  return <nav className="y-family" aria-label={locale === "fr" ? "Les produits Yodev" : "Yodev products"}><a href={`https://www.yodev.fr/${locale}`}>Yodev ↗</a>{(["mail", "ads", "spend"] as const).filter(product => product !== current).map(product => <a key={product} href={`https://${product}.yodev.fr/${product === "ads" ? "" : locale}`}>Yodev {product[0].toUpperCase() + product.slice(1)} ↗</a>)}</nav>;
}
