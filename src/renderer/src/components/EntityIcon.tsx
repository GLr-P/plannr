import { FileText, User, Wrench } from 'lucide-react'
import type { EntityType } from '../../../shared/api'

export function EntityIcon({ type, className }: { type: EntityType; className?: string }) {
  if (type === 'ticket') return <Wrench className={className} />
  if (type === 'customer') return <User className={className} />
  return <FileText className={className} />
}

export const ENTITY_LABEL: Record<EntityType, string> = { note: 'Note', ticket: 'Ticket', customer: 'Customer' }
