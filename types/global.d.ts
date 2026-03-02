export {}

declare global {
  interface Window {
    luckysheet?: {
      create: (options: any) => void
    }
  }
}