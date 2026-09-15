import { ImageResponse } from "next/og";
import { symbolPath, type YodevProduct } from "./brand";
import manifest from "./manifest.json";
export function brandImage(product: YodevProduct | "yodev", width: number, height: number, headline?: string) {
 const accent = manifest.products[product].accent;
 const label = product === "yodev" ? "yodev" : `yodev ${product[0].toUpperCase()+product.slice(1)}`;
 return new ImageResponse(<div style={{width:"100%",height:"100%",display:"flex",flexDirection:"column",justifyContent:headline?"space-between":"center",alignItems:headline?"flex-start":"center",background:manifest.colors.background,color:manifest.colors.text,padding:headline?64:width*.14}}><div style={{display:"flex",alignItems:"center",gap:20}}><svg width={headline?56:width*.72} height={headline?56:height*.72} viewBox="0 0 32 32" fill={accent}><path d={symbolPath}/></svg>{headline && <span style={{fontSize:40,fontWeight:600}}>{label}</span>}</div>{headline && <><div style={{fontSize:60,lineHeight:1.1,maxWidth:1040}}>{headline}</div><div style={{display:"flex",width:"100%",borderTop:"1px solid #343D37",paddingTop:24,fontSize:22,color:"#A5AFA8"}}>{product === "yodev" ? "yodev.fr" : `${product}.yodev.fr`}</div></>}</div>,{width,height});
}
