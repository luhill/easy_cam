import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useAppStore } from '../../store/useAppStore';
import { OperationCard } from './OperationCard';

export function OperationList() {
  const operations = useAppStore((s) => s.operations);
  const reorderOperations = useAppStore((s) => s.reorderOperations);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = operations.findIndex((o) => o.id === active.id);
    const toIndex = operations.findIndex((o) => o.id === over.id);
    if (fromIndex !== -1 && toIndex !== -1) {
      reorderOperations(fromIndex, toIndex);
    }
  };

  if (operations.length === 0) {
    return (
      <div className="operation-list-empty">
        <p>Add operations from the palette above</p>
      </div>
    );
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={operations.map((o) => o.id)} strategy={verticalListSortingStrategy}>
        <div className="operation-list">
          {operations.map((op) => (
            <OperationCard key={op.id} operation={op} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
