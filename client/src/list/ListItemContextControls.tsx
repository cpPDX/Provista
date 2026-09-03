import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { loadPantry } from '../pantry/api';
import { PantryItemDialog } from '../pantry/PantryItemDialog';
import { pantryProduct, pantryUnit, type PantryItem } from '../pantry/types';
import type { ProductRef } from '../products/types';
import { ListItemEditDialog } from './ListItemEditDialog';
import { updateShoppingListItem } from './api';
import { intendedPurchaseQuantity, productFor, type ShoppingListItem } from './types';
import '../pantry/pantry.css';
import './contextual-setup.css';

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

function adjustedRequiredQuantity(required: number | null, saved: PantryItem): number | null {
  if (required == null) return null;
  if (saved.trackingMode === 'exact') {
    return Math.max(0, required - Math.max(0, Number(saved.quantity) || 0));
  }
  return saved.stockStatus === 'have' ? 0 : required;
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

  const handlePantrySaved = async (saved: PantryItem) => {
    const nextRequired = adjustedRequiredQuantity(required, saved);
    if (nextRequired != null && nextRequired !== required) {
      try {
        const result = await updateShoppingListItem(item._id, { requiredQuantity: nextRequired }, item);
        queryClient.setQueryData<ShoppingListItem[]>(['shopping-list'], current =>
          current?.map(entry => entry._id === item._id ? { ...entry, ...result.data } : entry) || []
        );
      } catch (error) {
        // Pantry tracking succeeded and remains trustworthy. A requirement refresh
        // failure should not roll back or hide that stock update; a List refetch can
        // retry/reconcile the derived requirement later.
        console.info('Could not refresh List requirement after Pantry tracking:', error);
      }
    }

    setTrackingProduct(null);
    await queryClient.invalidateQueries({ queryKey: ['pantry'] });
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
