import tolerances from '../../config/tolerances.js';

/**
 * Checks if a user transaction type and an exchange transaction type align.
 * Standard matches are identical types (e.g. BUY ↔ BUY), while transfer type mappings
 * align TRANSFER_OUT ↔ TRANSFER_IN.
 * 
 * @param {string} type1 
 * @param {string} type2 
 * @returns {boolean}
 */
export const checkTypeAlignment = (type1, type2) => {
  const t1 = (type1 || '').toUpperCase().trim();
  const t2 = (type2 || '').toUpperCase().trim();

  if (t1 === t2) return true;
  if (t1 === 'TRANSFER_IN' && t2 === 'TRANSFER_OUT') return true;
  if (t1 === 'TRANSFER_OUT' && t2 === 'TRANSFER_IN') return true;

  return false;
};

/**
 * Calculates a match score and confidence level between a user transaction and an exchange transaction.
 * Requires asset to match exactly. Applies weighted scoring:
 * - Timestamp proximity: 50%
 * - Quantity proximity: 30%
 * - Type alignment: 20%
 * 
 * @param {Object} userTx - The Mongoose Transaction document from USER.
 * @param {Object} exchangeTx - The Mongoose Transaction document from EXCHANGE.
 * @returns {{ isMatch: boolean, confidence: number, reason: string }}
 */
export const calculateMatchScore = (userTx, exchangeTx) => {
  const u = userTx.normalized;
  const e = exchangeTx.normalized;

  // 1. Asset must match exactly.
  if (u.asset !== e.asset) {
    return {
      isMatch: false,
      confidence: 0,
      reason: `Asset mismatch: user recorded ${u.asset || 'N/A'}, exchange recorded ${e.asset || 'N/A'}`
    };
  }

  // 2. Type Alignment check (Weight = 20)
  const isTypeAligned = checkTypeAlignment(u.type, e.type);
  const typeScore = isTypeAligned ? 20 : 0;

  // 3. Timestamp proximity check (Weight = 50)
  const timeDiffSeconds = Math.abs(u.timestamp.getTime() - e.timestamp.getTime()) / 1000;
  const isTimeWithinTolerance = timeDiffSeconds <= tolerances.timestampToleranceSeconds;
  
  let timestampScore = 0;
  if (isTimeWithinTolerance) {
    // Proportional matching score: linear decay towards the tolerance limit
    timestampScore = 50 * (1 - (timeDiffSeconds / tolerances.timestampToleranceSeconds));
  }

  // 4. Quantity proximity check (Weight = 30)
  const qtyDiff = Math.abs(u.quantity - e.quantity);
  // Relativize quantity difference to user quantity
  const qtyPct = u.quantity > 0 ? qtyDiff / u.quantity : 0;
  const isQtyWithinTolerance = qtyPct <= tolerances.quantityTolerancePct;

  let quantityScore = 0;
  if (isQtyWithinTolerance) {
    // Proportional matching score: linear decay towards the tolerance limit
    quantityScore = 30 * (1 - (qtyPct / tolerances.quantityTolerancePct));
  }

  // Total scoring (max 100) and confidence (0.0 to 1.0)
  const totalScore = typeScore + timestampScore + quantityScore;
  const confidence = Number((totalScore / 100).toFixed(4));

  // A match is confirmed ONLY if all individual criteria are satisfied within tolerances
  const isMatch = isTypeAligned && isTimeWithinTolerance && isQtyWithinTolerance;

  let reason = '';
  if (isMatch) {
    reason = `Confirmed match: type aligns, time difference ${timeDiffSeconds.toFixed(1)}s, quantity variance ${(qtyPct * 100).toFixed(3)}%`;
  } else {
    const conflicts = [];
    if (!isTypeAligned) conflicts.push(`type mismatch (${u.type} vs ${e.type})`);
    if (!isTimeWithinTolerance) conflicts.push(`time difference of ${timeDiffSeconds.toFixed(1)}s exceeds limit`);
    if (!isQtyWithinTolerance) conflicts.push(`quantity variance of ${(qtyPct * 100).toFixed(2)}% exceeds limit`);
    reason = `Conflict details: ${conflicts.join(', ')}`;
  }

  return {
    isMatch,
    confidence,
    reason,
  };
};

export default calculateMatchScore;
