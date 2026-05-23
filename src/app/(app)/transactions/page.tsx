"use client";

import { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { Transaction } from "@/types";
import { useTransactions } from "@/hooks/useTransactions";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import {
  filterAndSortTransactions,
  getTransactionCategories,
  groupTransactionsByDate,
  type DatePreset,
} from "@/features/transactions/utils/list";
import { TransactionSheet } from "@/components/transactions/TransactionSheet";
import { useTransactionSuggestions } from "@/features/transactions/hooks/useTransactionSuggestions";
import { useReceiptProcessingPoller } from "@/features/transactions/hooks/useReceiptProcessingPoller";
import { useDuplicateResolution } from "@/features/transactions/hooks/useDuplicateResolution";
import { InFlightReceiptBanner } from "@/features/transactions/components/InFlightReceiptBanner";
import { TransactionFilters } from "@/features/transactions/components/TransactionFilters";
import { TransactionGroups } from "@/features/transactions/components/TransactionGroups";
import { DuplicateGroupsList } from "@/features/transactions/components/DuplicateGroupsList";
import { SuggestionsSheet } from "@/features/transactions/components/SuggestionsSheet";
import { DuplicateGroupSheet } from "@/features/transactions/components/DuplicateGroupSheet";
import { receiptsApi } from "@/lib/api/receipts";
import { decodeMergeMetadata } from "@/domain/transactions/metadata";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function TransactionsContent() {
  const searchParams = useSearchParams();
  const isOnline = useOnlineStatus();
  const { transactions, total, hasMore, syncing, loadingMore, refresh, loadMore } = useTransactions();
  const [loading, setLoading] = useState(transactions.length === 0);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("");
  const [showDupsOnly, setShowDupsOnly] = useState(searchParams.get("duplicates_only") === "true");
  const [datePreset, setDatePreset] = useState<DatePreset>("");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const loadData = useCallback(async () => {
    try {
      return await refresh();
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { suggestions, activeSuggTxId, setActiveSuggTxId, loadSuggestions, handleSuggestion } =
    useTransactionSuggestions(loadData);
  const { triggerProcessing, region } = useReceiptProcessingPoller(transactions, isOnline, loadData);
  const { dupChecking, dupError, activeDupGroup, setActiveDupGroup, triggerDupDetect, resolveDuplicate, dismissGroup } =
    useDuplicateResolution(loadData);

  useEffect(() => {
    loadData().then((txs) => {
      triggerProcessing(txs);
      loadSuggestions(txs);
    });
  }, [loadData, triggerProcessing, loadSuggestions]);

  const categories = getTransactionCategories(transactions);
  const filtered = filterAndSortTransactions(transactions, { search, category: filterCat, showDuplicatesOnly: showDupsOnly, datePreset, customFrom, customTo });
  const groups = groupTransactionsByDate(filtered);
  const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  // IDs of transactions currently being merged (source=merge, status=merging)
  // Used to show per-group merging state in the duplicate list and sheet.
  const mergingSourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tx of transactions) {
      if (tx.source === "merge" && tx.status === "merging") {
        decodeMergeMetadata(tx.notes).forEach((id) => ids.add(id));
      }
    }
    return ids;
  }, [transactions]);

  return (
    <div className="max-w-2xl mx-auto px-5 pt-6 flex flex-col gap-4 overflow-hidden"
      style={{ height: "calc(100dvh - 96px)" }}>

      <div className="flex items-center justify-between flex-shrink-0">
        <h1 className="hidden md:block font-bold" style={{ fontSize: 24, color: "var(--color-on-background)" }}>Transactions</h1>
        {total > 0 && (
          <span style={{ fontSize: 13, color: "var(--color-on-surface-variant)" }}>
            {transactions.length} of {total}
          </span>
        )}
      </div>

      <div className="flex-shrink-0">
        <InFlightReceiptBanner transactions={transactions} />
      </div>

      <div className="flex-shrink-0">
        <TransactionFilters
          search={search} onSearchChange={setSearch}
          filterCat={filterCat} onCatChange={setFilterCat}
          showDupsOnly={showDupsOnly}
          onDupsToggle={() => { const next = !showDupsOnly; setShowDupsOnly(next); if (next) triggerDupDetect(); }}
          dupChecking={dupChecking}
          datePreset={datePreset} onDatePresetChange={setDatePreset}
          customFrom={customFrom} onCustomFromChange={setCustomFrom}
          customTo={customTo} onCustomToChange={setCustomTo}
          categories={categories}
        />
      </div>

      {/* Scrollable list — fills remaining height */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-4">
        {loading && transactions.length === 0 ? (
          <div className="flex flex-col gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: "var(--color-surface-container)" }} />
            ))}
          </div>
        ) : showDupsOnly ? (
          <DuplicateGroupsList
            transactions={transactions}
            dupChecking={dupChecking}
            dupError={dupError}
            onRetry={triggerDupDetect}
            onGroupClick={setActiveDupGroup}
            mergingSourceIds={mergingSourceIds}
          />
        ) : (
          <>
            <ErrorBoundary>
              <TransactionGroups
                sortedDates={sortedDates}
                groups={groups}
                suggestions={suggestions}
                onSuggestionsClick={setActiveSuggTxId}
                onTransactionClick={setSelectedTx}
                onResolveDuplicate={resolveDuplicate}
                searchActive={!!search}
                onRetryReceipt={async (txId) => {
                  await receiptsApi.process(txId, region);
                  loadData();
                }}
              />
            </ErrorBoundary>

            {/* Load more */}
            {hasMore && !search && !filterCat && !datePreset && !showDupsOnly && (
              <button
                onClick={loadMore}
                disabled={loadingMore || syncing}
                className="w-full py-3.5 rounded-2xl font-medium flex items-center justify-center gap-2 mt-4"
                style={{
                  background: "var(--color-surface-container)",
                  color: "var(--color-on-surface-variant)",
                  fontSize: 14,
                  opacity: loadingMore || syncing ? 0.6 : 1,
                }}
              >
                {loadingMore ? (
                  <>
                    <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
                      style={{ borderColor: "var(--color-outline)", borderTopColor: "var(--color-on-surface-variant)" }} />
                    Loading…
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>expand_more</span>
                    Load older transactions ({total - transactions.length} more)
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>

      {activeSuggTxId && (
        <SuggestionsSheet
          txId={activeSuggTxId}
          suggestions={suggestions}
          onAction={handleSuggestion}
          onClose={() => setActiveSuggTxId(null)}
        />
      )}

      {selectedTx && (
        <TransactionSheet tx={selectedTx} onClose={() => setSelectedTx(null)} />
      )}

      {activeDupGroup && (
        <DuplicateGroupSheet
          group={activeDupGroup}
          onRemove={(tx) => resolveDuplicate(tx, "remove")}
          onDismissAll={() => dismissGroup(activeDupGroup)}
          onClose={() => setActiveDupGroup(null)}
          onViewTransaction={setSelectedTx}
          isMerging={[activeDupGroup.original.id, ...activeDupGroup.duplicates.map((d) => d.id)]
            .some((id) => mergingSourceIds.has(id))}
        />
      )}
    </div>
  );
}

export default function TransactionsPage() {
  return <Suspense><TransactionsContent /></Suspense>;
}
