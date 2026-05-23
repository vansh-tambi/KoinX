import dotenv from 'dotenv';

dotenv.config();

export const tolerances = {
  // Maximum allowed absolute amount difference for a match
  amountDifference: parseFloat(process.env.TOLERANCE_AMOUNT_DIFFERENCE || '0.01'),
  
  // Maximum allowed time difference in seconds for a match
  dateWindowSeconds: parseInt(process.env.TOLERANCE_DATE_WINDOW_SECONDS || '60', 10),
};

export default tolerances;
