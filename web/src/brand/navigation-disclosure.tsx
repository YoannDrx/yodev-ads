"use client";
import { useRef, type ReactNode } from "react";

/** A non-modal navigation disclosure with native keyboard semantics. */
export function NavigationDisclosure({label,className,icon,children}:{label:string;className?:string;icon:ReactNode;children:ReactNode}) {
  const details=useRef<HTMLDetailsElement>(null);
  function close(restoreFocus=false) {
    if (!details.current) return;
    details.current.open=false;
    if (restoreFocus) details.current.querySelector('summary')?.focus();
  }
  return <details ref={details} className={className}
    onKeyDown={event=>{if(event.key==='Escape'){close(true);event.stopPropagation();}}}
    onClick={event=>{if((event.target as HTMLElement).closest('a[href]')) close();}}
    onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null)) close();}}>
    <summary aria-label={label}>{icon}</summary>{children}
  </details>;
}
