import { Router } from "express";
import { readJSON, writeJSON } from "../lib/storage.js";
import { requireAdmin } from "../middleware/admin.js";
import type { Pricing } from "../types.js";

const DEFAULT_PRICING: Pricing = { lowSeason: 120, midSeason: 160, highSeason: 210 };

function pricingFields(body: Record<string, unknown>): Pricing | undefined {
  const pricing = {
    lowSeason: Number(body.lowSeason),
    midSeason: Number(body.midSeason),
    highSeason: Number(body.highSeason),
  };
  return Object.values(pricing).every((rate) => Number.isInteger(rate) && rate >= 1 && rate <= 10_000) ? pricing : undefined;
}

export function createPricingRouter(pricingFile: string): Router {
  const router = Router();

  router.get("/", async (_request, response, next) => {
    try {
      response.json(await readJSON<Pricing>(pricingFile, DEFAULT_PRICING));
    } catch (error) {
      next(error);
    }
  });

  router.put("/", requireAdmin, async (request, response, next) => {
    try {
      const pricing = pricingFields(request.body as Record<string, unknown>);
      if (!pricing) {
        response.status(400).json({ message: "Alle Saisonpreise müssen ganze Eurobeträge zwischen 1 und 10.000 sein." });
        return;
      }
      await writeJSON(pricingFile, pricing);
      response.json(pricing);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
