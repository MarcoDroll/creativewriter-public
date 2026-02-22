import { Observable, OperatorFunction } from 'rxjs';
import { bufferTime, filter, map } from 'rxjs/operators';

/**
 * Batches streaming chunks for smoother DOM updates.
 * Uses bufferTime to collect chunks and emit them as a single concatenated string.
 *
 * @param intervalMs - Buffer interval in milliseconds (default: 100ms for mobile-friendly performance)
 * @param maxCount - Max chunks to buffer before emitting (default: 10)
 * @returns An RxJS operator that batches string chunks
 *
 * @example
 * ```typescript
 * provider.generateTextStream(prompt).pipe(
 *   batchStreamingChunks(100, 10),
 *   tap(batchedText => appendToEditor(batchedText))
 * ).subscribe();
 * ```
 */
export function batchStreamingChunks(
  intervalMs = 100,
  maxCount = 10
): OperatorFunction<string, string> {
  return (source: Observable<string>): Observable<string> => source.pipe(
    bufferTime(intervalMs, null, maxCount),
    filter(chunks => chunks.length > 0),
    map(chunks => chunks.join(''))
  );
}
