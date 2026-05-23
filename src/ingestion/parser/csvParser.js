import { parse } from 'csv-parse';

/**
 * Parses a CSV stream and invokes callbacks for row processing.
 * Designed for memory-efficient stream parsing.
 * 
 * @param {import('stream').Readable} readableStream - The input CSV readable stream.
 * @param {Object} options - Parser options.
 * @param {Function} onRow - Callback invoked for each parsed row: async (row) => void.
 * @param {Function} onWarning - Callback for non-blocking validation warnings: (warning, row) => void.
 * @returns {Promise<{ totalRows: number }>}
 */
export const parseCsvStream = async (readableStream, options = {}, onRow, onWarning) => {
  return new Promise((resolve, reject) => {
    let totalRows = 0;
    
    const parser = readableStream.pipe(
      parse({
        columns: true, // Auto-discover column names from header row
        skip_empty_lines: true,
        trim: true,
        ...options,
      })
    );
    
    parser.on('data', async (row) => {
      totalRows++;
      // Pause parsing stream to process row asynchronously without overwhelming memory
      parser.pause();
      try {
        await onRow(row);
      } catch (err) {
        if (onWarning) {
          onWarning(err.message, row);
        }
      } finally {
        parser.resume();
      }
    });
    
    parser.on('end', () => {
      resolve({ totalRows });
    });
    
    parser.on('error', (err) => {
      reject(err);
    });
  });
};

export default parseCsvStream;
