/**
 * Pocket Scout v12.0.0 - Circular Buffer
 * Efficient candle data storage for multi-pair analysis.
 */
(function(window) {
  'use strict';

  let instance;

  function createCircularBuffer(capacity = 2000) {
    const buffer = new Array(capacity);
    let size = 0;
    let head = 0;

    function add(candle) {
      buffer[head] = candle;
      head = (head + 1) % capacity;
      if (size < capacity) {
        size++;
      }
    }

    function updateLast(data) {
      if (size === 0) return;
      const lastIndex = (head - 1 + capacity) % capacity;
      buffer[lastIndex] = { ...buffer[lastIndex], ...data };
    }

    function getLatest() {
      if (size === 0) return null;
      const lastIndex = (head - 1 + capacity) % capacity;
      return buffer[lastIndex];
    }

    function getAll() {
      if (size === 0) return [];
      const result = new Array(size);
      const start = (head - size + capacity) % capacity;
      for (let i = 0; i < size; i++) {
        const index = (start + i) % capacity;
        result[i] = buffer[index];
      }
      return result;
    }

    console.log(`[Pocket Scout v12.0.0] Circular Buffer loaded - ${capacity} candles capacity`);

    return { add, updateLast, getLatest, getAll, size: () => size };
  }

  window.CircularBuffer = {
    getInstance: function(capacity) {
      if (!instance) {
        instance = createCircularBuffer(capacity);
      }
      return instance;
    }
  };

})(window);
