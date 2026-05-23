import { z } from 'zod';

export const rawTransactionSchema = z.object({
  externalId: z.string().min(1, 'externalId is required'),
  provider: z.string().min(1, 'provider is required'),
  type: z.string().min(1, 'type is required'),
  status: z.string().min(1, 'status is required'),
  amount: z.union([z.string(), z.number()]).transform((val) => {
    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num)) throw new Error('amount must be a valid number');
    return num;
  }),
  currency: z.string().min(1, 'currency is required'),
  transactionDate: z.string().min(1, 'transactionDate is required'),
});

/**
 * Validates a raw transaction record.
 * 
 * @param {Object} row - The raw record parsed from CSV.
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
export const validateRawTransaction = (row) => {
  const result = rawTransactionSchema.safeParse(row);
  if (!result.success) {
    return {
      success: false,
      error: result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; '),
    };
  }
  return {
    success: true,
    data: result.data,
  };
};

export default validateRawTransaction;
