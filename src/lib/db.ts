import Dexie from 'dexie'

class CleaningPlannerDB extends Dexie {
  constructor() {
    super('cleaning-planner')
  }
}

export const db = new CleaningPlannerDB()
