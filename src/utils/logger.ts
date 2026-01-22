export const logger = {
  log: (message: string) => console.log(message),
  info: (message: string) => console.log(message),
  success: (message: string) => console.log(message),
  warn: (message: string) => console.warn(message),
  error: (message: string, ...args: any[]) => console.error(message, ...args),
};
