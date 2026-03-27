"use client"

import { useLeadAgencyFilter } from "@/contexts/lead-agency-filter-context"
import { Building2, ChevronDown, Check, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState, useRef, useEffect } from "react"

export function LeadAgencyFilter({ className }: { className?: string }) {
  const { confirmedAgencies, selectedAgencyId, setSelectedAgencyId, isLoading } = useLeadAgencyFilter()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  const selectedAgency = selectedAgencyId 
    ? confirmedAgencies.find(a => a.agencyId === selectedAgencyId)
    : null

  if (isLoading) {
    return (
      <div className={cn("h-9 w-48 bg-white/5 rounded-lg animate-pulse", className)} />
    )
  }

  // Don't show filter if no confirmed agencies
  if (confirmedAgencies.length === 0) {
    return null
  }

  return (
    <div className={cn("relative", className)} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors min-w-[200px]",
          selectedAgencyId
            ? "bg-[#0C3535] border-[#0C3535] text-white"
            : "bg-[#0C3535]/10 border-[#0C3535]/30 text-[#0C3535] hover:bg-[#0C3535]/20"
        )}
      >
        <Building2 className="w-4 h-4 flex-shrink-0" />
        <span className="text-sm font-medium truncate flex-1 text-left">
          {selectedAgency ? selectedAgency.agencyName : "All Lead Agencies"}
        </span>
        <ChevronDown className={cn(
          "w-4 h-4 flex-shrink-0 transition-transform",
          isOpen && "rotate-180"
        )} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-full min-w-[250px] bg-white border border-gray-200 rounded-lg shadow-xl z-50 overflow-hidden">
          {/* All agencies option */}
          <button
            onClick={() => {
              setSelectedAgencyId(null)
              setIsOpen(false)
            }}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors",
              !selectedAgencyId
                ? "bg-[#0C3535]/10 text-[#0C3535]"
                : "hover:bg-gray-50 text-gray-700"
            )}
          >
            <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-4 h-4 text-gray-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium">All Lead Agencies</div>
              <div className="text-xs text-gray-500">
                View all engagements
              </div>
            </div>
            {!selectedAgencyId && (
              <Check className="w-4 h-4 text-[#0C3535] flex-shrink-0" />
            )}
          </button>

          <div className="h-px bg-gray-200" />

          {/* Confirmed agencies */}
          {confirmedAgencies.map((agency) => (
            <button
              key={agency.agencyId}
              onClick={() => {
                setSelectedAgencyId(agency.agencyId)
                setIsOpen(false)
              }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors",
                selectedAgencyId === agency.agencyId
                  ? "bg-[#0C3535]/10 text-[#0C3535]"
                  : "hover:bg-gray-50 text-gray-700"
              )}
            >
              <div className="w-8 h-8 rounded-full bg-[#0C3535]/10 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-bold text-[#0C3535]">
                  {agency.agencyName.split(' ').map(w => w[0]).join('').slice(0, 2)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{agency.agencyName}</div>
                <div className="text-xs text-gray-500 truncate">
                  {agency.agencyLocation}
                </div>
              </div>
              {selectedAgencyId === agency.agencyId && (
                <Check className="w-4 h-4 text-[#0C3535] flex-shrink-0" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Compact version for use in headers
export function LeadAgencyFilterCompact({ className }: { className?: string }) {
  const { confirmedAgencies, selectedAgencyId, setSelectedAgencyId, isLoading } = useLeadAgencyFilter()

  if (isLoading || confirmedAgencies.length === 0) {
    return null
  }

  const selectedAgency = selectedAgencyId 
    ? confirmedAgencies.find(a => a.agencyId === selectedAgencyId)
    : null

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-xs text-[#0C3535]/70 uppercase tracking-wider font-medium">Filter:</span>
      <select
        value={selectedAgencyId || ""}
        onChange={(e) => setSelectedAgencyId(e.target.value || null)}
        className="bg-[#0C3535]/10 border border-[#0C3535]/30 rounded px-2 py-1 text-sm text-[#0C3535] min-w-[150px]"
      >
        <option value="">All Lead Agencies</option>
        {confirmedAgencies.map((agency) => (
          <option key={agency.agencyId} value={agency.agencyId}>
            {agency.agencyName}
          </option>
        ))}
      </select>
      {selectedAgencyId && (
        <button
          onClick={() => setSelectedAgencyId(null)}
          className="p-1 hover:bg-white/10 rounded transition-colors"
          title="Clear filter"
        >
          <X className="w-3 h-3 text-foreground-muted" />
        </button>
      )}
    </div>
  )
}
