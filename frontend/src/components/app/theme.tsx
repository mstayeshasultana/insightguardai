import { useEffect, useState } from "react";

export type Theme = "light" | "dark";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);
  const apply = (t: Theme) => {
    setTheme(t);
    document.documentElement.classList.toggle("dark", t === "dark");
    localStorage.setItem("ig-theme", t);
  };
  return { theme, setTheme: apply, toggle: () => apply(theme === "dark" ? "light" : "dark") };
}

/** Inline script that applies the saved theme before paint. */
export const themeInitScript = `try{if(localStorage.getItem('ig-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`;
