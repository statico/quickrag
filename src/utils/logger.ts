const DEBUG = process.env.DEBUG === "1" || process.env.DEBUG === "true";

export const logger = {
  log: (message: string) => console.log(message),
  info: (message: string) => console.log(message),
  success: (message: string) => console.log(message),
  warn: (message: string) => console.warn(message),
  error: (message: string, ...args: any[]) => console.error(message, ...args),
  debug: (message: string) => {
    if (DEBUG) {
      console.debug(`[DEBUG] ${message}`);
    }
  },
};
