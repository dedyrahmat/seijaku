import { useResolvedTheme } from "./preferences";

/** Seijaku follows the system theme unless Settings says otherwise: washi paper by day, sumi ink by night. */
export function useColorScheme(): "light" | "dark" {
	return useResolvedTheme();
}
