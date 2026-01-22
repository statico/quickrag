import { consola } from "consola";

export const logger = consola.withTag("quickrag").withDefaults({
  formatOptions: {
    date: false,
  },
});
