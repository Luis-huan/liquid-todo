import type { LiquidTodoApi } from '../../shared/types'

declare global {
  interface Window {
    liquidTodo: LiquidTodoApi
  }
}

export const api: LiquidTodoApi = window.liquidTodo
