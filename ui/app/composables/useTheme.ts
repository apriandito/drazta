const KEY = "drazta-theme";
type Theme = "light" | "dark";

/**
 * Theme lives on the html element as `data-theme`, set before paint by a head
 * script so there is no flash of the wrong palette on reload.
 */
export function useTheme() {
  const theme = useState<Theme>("theme", () => "light");

  onMounted(() => {
    const stored = localStorage.getItem(KEY) as Theme | null;
    theme.value =
      stored ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    apply(theme.value);
  });

  function apply(next: Theme) {
    document.documentElement.dataset.theme = next;
  }

  function toggle() {
    theme.value = theme.value === "dark" ? "light" : "dark";
    localStorage.setItem(KEY, theme.value);
    apply(theme.value);
  }

  return { theme, toggle };
}
