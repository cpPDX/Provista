import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadPantry } from '../pantry/api';
import { PantryItemDialog } from '../pantry/PantryItemDialog';
import { pantryProduct, pantryUnit, type PantryItem } from '../pantry/types';
import type { ProductRef } from '../products/types';
import { ListItemEditDialog } from './ListItemEditDialog';
import { intendedPurchaseQuantity, productFor, type ShoppingListItem } from './types';
import '../pantry/pantry.css';

interface ListItemContextControlsProps {
  item: ShoppingListItem;
  online: boolean;
}

function pantrySummary(item: PantryItem): string {
  if (item.trackingMode === 'exact') {
    const unit = pantryUnit(item);
    return `Pantry: ${Number(item.quantity) || 0}${unit ? ` ${unit}` : ''} on hand`;
  }
  const label = item.stockStatus === 'low'
    ? 'Running low'
    : item.stockStatus === 'out'
      ? 'Out'
      : 'Have';
  return `Pantry: ${label}`;
}

export function ListItemContextControls({ item, online }: ListItemContextControlsProps) {
  const queryClient = useQueryClient();
  const pantryQuery = useQuery({ queryKey: ['pantry'], queryFn: loadPantry });
  const [editingQuantity, setEditingQuantity] = useState(false);
  const [trackingProduct, setTrackingProduct] = useState<ProductRef | null>(null);
  const product = productFor(item);
  const pantryItem = product
    ? (pantryQuery.data || []).find(entry => pantryProduct(entry)?._id === product._id) || null
    : null;
  const required = item.requiredQuantity == null ? null : Number(item.requiredQuantity);
  const intended = intendedPurchaseQuantity(item);
  const remainder = required == null ? 0 : Math.max(0, required - intended);

  const handlePantrySaved = async () => {
    setTrackingProduct(null);
    await queryClient.invalidateQueries({ queryKey: ['pantry'] });
    // Pantry context can change system-derived shortage calculations elsewhere,
    // so refresh List/Plan data without discarding an explicit quantity override.
    await queryClient.invalidateQueries({ queryKey: ['shopping-list'] });
    await queryClient.invalidateQueries({ queryKey: ['meal-plan'] });
  };

  return (
    <div className="react-list-context-controls">
      <div className="react-list-quantity-line">
        <span>
          Buy {intended}
          {required != null && item.quantitySource === 'system' ? ` · ${required} required` : ''}
          {item.checked && item.actualPurchasedQuantity != null ? ` · got ${item.actualPurchasedQuantity}` : ''}
        </span>
        <button type="button" className="react-list-store-preference" onClick={() => setEditingQuantity(true)}>
          Edit quantity
        </button>
      </div>

      {remainder > 0 && <small>{remainder} still needed from the current Plan/Pantry requirement</small>}

      {pantryQuery.isPending ? (
        <small>Checking Pantry…</small>
      ) : pantryItem ? (
        <small>{pantrySummary(pantryItem)}</small>
      ) : product ? (
        <div className="react-list-pantry-context">
          <small>Not in Pantry</small>
          <button type="button" className="react-list-store-preference" onClick={() => setTrackingProduct(product)} disabled={!online}>
            Track it?
          </button>
        </div>
      ) : null}

      {editingQuantity && <ListItemEditDialog item={item} onClose={() => setEditingQuantity(false)} />}
      {trackingProduct && (
        <PantryItemDialog
          mode="add"
          initialProduct={trackingProduct}
          online={online}
          onClose={() => setTrackingProduct(null)}
          onSaved={handlePantrySaved}
        />
      )}
    </div>
  );
}
