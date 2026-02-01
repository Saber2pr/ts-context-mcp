
      export class Calculator {
        private base: number = 0;
        
        constructor(val: number) {
          this.base = val;
        }

        public add(x: number): number {
          const result = this.base + x;
          return result;
        }

        private clear() {
          this.base = 0;
        }
      }
    