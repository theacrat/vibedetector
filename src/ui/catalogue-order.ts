import { useCallback, useEffect, useRef } from "react";

function useCatalogueOrder({
  ids,
  id,
  index,
  pending,
  onOrder,
}: {
  ids: string[];
  id: string;
  index: number;
  pending: boolean;
  onOrder: (ids: string[]) => void;
}) {
  const up = useRef<HTMLButtonElement>(null);
  const down = useRef<HTMLButtonElement>(null);
  const moved = useRef<"up" | "down" | undefined>(undefined);
  useEffect(() => {
    if (!pending && moved.current) {
      const preferred = moved.current === "up" ? up.current : down.current;
      const alternative = moved.current === "up" ? down.current : up.current;
      (preferred?.disabled ? alternative : preferred)?.focus();
      moved.current = undefined;
    }
  }, [pending]);
  const move = useCallback(
    (direction: "up" | "down") => {
      const adjacent = index + (direction === "up" ? -1 : 1);
      const neighbour = ids[adjacent];
      if (pending || neighbour === undefined) {
        return;
      }
      const order = [...ids];
      order[adjacent] = id;
      order[index] = neighbour;
      moved.current = direction;
      onOrder(order);
    },
    [id, ids, index, onOrder, pending],
  );
  const moveUp = useCallback(() => {
    move("up");
  }, [move]);
  const moveDown = useCallback(() => {
    move("down");
  }, [move]);
  return { down, moveDown, moveUp, up };
}

export { useCatalogueOrder };
