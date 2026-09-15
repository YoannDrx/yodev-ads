"use client";
import { ThemeProvider, useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
export function AppearanceProvider({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
 return <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange nonce={nonce}>{children}</ThemeProvider>;
}
export function AppearanceToggle({ locale = "fr" }: { locale?: string }) {
 const { setTheme } = useTheme();
 return <button type="button" className="y-theme-toggle" aria-label={locale === "fr" ? "Changer le thème" : "Change theme"} onClick={() => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark")}><Sun className="y-dark-icon" aria-hidden="true"/><Moon className="y-light-icon" aria-hidden="true"/></button>;
}
