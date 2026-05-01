/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "ui-monospace", "monospace"],
      },
      colors: {
        terminal: {
          950: "#08090d",
          900: "#0d1015",
          850: "#12161d",
          800: "#171c24",
          700: "#242b35",
        },
      },
      boxShadow: {
        panel: "0 18px 45px rgba(0, 0, 0, 0.24)",
      },
    },
  },
  plugins: [],
};
