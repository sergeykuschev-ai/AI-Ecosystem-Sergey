import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  BONUS_CARD_THRESHOLDS_RUB,
  BONUS_EARN_RATE,
  BONUS_SPEND_CAP_LABEL,
  BONUS_SPEND_CAP_PERCENT,
  BONUS_VALIDITY_LABEL,
  BONUS_VALIDITY_MONTHS,
  formatRubles,
} from "@/lib/constants/bonus";
import { mockBonusProgram } from "@/lib/data/mock-data";

describe("bonus program rules", () => {
  test("accrual rate is 5%", () => {
    assert.equal(BONUS_EARN_RATE, "5%");
  });

  test("redemption cap is 15%", () => {
    assert.equal(BONUS_SPEND_CAP_PERCENT, 15);
    assert.equal(BONUS_SPEND_CAP_LABEL, "до 15%");
  });

  test("bonus validity is 3 months", () => {
    assert.equal(BONUS_VALIDITY_MONTHS, 3);
    assert.equal(BONUS_VALIDITY_LABEL, "3 месяца");
  });
});

describe("bonus card thresholds", () => {
  test("3500 RUB for amper, ventil and metiz-market", () => {
    assert.equal(BONUS_CARD_THRESHOLDS_RUB.amper, 3500);
    assert.equal(BONUS_CARD_THRESHOLDS_RUB.ventil, 3500);
    assert.equal(BONUS_CARD_THRESHOLDS_RUB["metiz-market"], 3500);
  });

  test("2000 RUB for miska", () => {
    assert.equal(BONUS_CARD_THRESHOLDS_RUB.miska, 2000);
  });

  test("thresholds are positive whole ruble amounts", () => {
    for (const amount of Object.values(BONUS_CARD_THRESHOLDS_RUB)) {
      assert.ok(Number.isInteger(amount) && amount > 0, `threshold ${amount}`);
    }
  });
});

describe("formatRubles", () => {
  test("formats thousands with a regular space and the ₽ sign", () => {
    assert.equal(formatRubles(3500), "3 500 ₽");
    assert.equal(formatRubles(2000), "2 000 ₽");
    assert.equal(formatRubles(1000000), "1 000 000 ₽");
  });
});

describe("mock bonus program follows the canonical rules", () => {
  test("rules are 5% accrual, 15% redemption cap, 3 months validity", () => {
    assert.deepEqual(mockBonusProgram.rules, ["5%", "15%", "3 месяца"]);
  });

  test("derived rule strings match the canonical constants", () => {
    assert.equal(mockBonusProgram.rules[0], BONUS_EARN_RATE);
    assert.equal(mockBonusProgram.rules[1], `${BONUS_SPEND_CAP_PERCENT}%`);
    assert.equal(mockBonusProgram.rules[2], BONUS_VALIDITY_LABEL);
  });
});
