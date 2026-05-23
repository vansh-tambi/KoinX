import dotenv from 'dotenv';

dotenv.config();

export const tolerances = {
  // Maximum allowed time difference in seconds for a match
  timestampToleranceSeconds: parseInt(
    process.env.TIMESTAMP_TOLERANCE_SECONDS || 
    process.env.TOLERANCE_DATE_WINDOW_SECONDS || 
    '60', 
    10
  ),
  
  // Maximum allowed relative quantity difference as a decimal percentage (e.g. 0.02 = 2%)
  quantityTolerancePct: parseFloat(
    process.env.QUANTITY_TOLERANCE_PCT || 
    '0.02'
  ),
};

export default tolerances;
