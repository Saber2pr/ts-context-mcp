/**
 * 这是一个用于测试 getMethodImplementation 的模拟文件
 */

export interface Result {
  value: number;
}

// 1. 测试普通导出函数
export function globalHelper() {
  console.log("helper");
  return true;
}

// 2. 测试变量/箭头函数导出
export const arrowFunc = () => {
  return "arrow";
};

// 3. 测试类及其成员方法
export class Calculator {
  private base: number = 0;

  constructor(val: number) {
    this.base = val;
  }

  // 目标测试方法
  public calculate(a: number, b: number): number {
    const sum = a + b;
    return sum + this.base;
  }

  /**
   * 内部私有方法测试
   */
  private internalLog(msg: string) {
    console.log(msg);
  }
}

// 4. 非导出的本地函数（测试引擎是否也能搜到）
function localOnly() {
  return "local";
}