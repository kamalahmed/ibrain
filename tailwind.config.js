/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f4f1ff",
          100: "#ebe5ff",
          200: "#d9ccff",
          300: "#bfa6ff",
          400: "#9d77ff",
          500: "#7e4dff",
          600: "#6a34f5",
          700: "#5925d6",
          800: "#4a21ad",
          900: "#3e1f8c",
        },
        accent: {
          teal: "#2dd4bf",
          blue: "#38bdf8",
          pink: "#f472b6",
          amber: "#fbbf24",
        },
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      boxShadow: {
        soft: "0 10px 30px -10px rgba(99, 52, 245, 0.35)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        pulseSoft: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.04)" },
        },
      },
      animation: {
        "fade-in": "fade-in 240ms ease-out both",
        "pulse-soft": "pulseSoft 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
