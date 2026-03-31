"use client"

import { useState } from "react"
import { PartnerLayout } from "@/components/partner-layout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { isDemoMode } from "@/lib/demo-data"

type Payment = {
  id: string
  project: string
  milestone: string
  amount: number
  status: "paid" | "pending" | "upcoming"
  date: string
  invoiceId?: string
}

// Demo data - only shown when NEXT_PUBLIC_IS_DEMO=true
const demoPaymentHistory: Payment[] = [
  { id: "1", project: "NWSL Creator Content Series", milestone: "Kick-off", amount: 19400, status: "paid", date: "Jan 14, 2026", invoiceId: "INV-001" },
  { id: "2", project: "NWSL Creator Content Series", milestone: "Mid-point", amount: 38800, status: "paid", date: "Feb 28, 2026", invoiceId: "INV-002" },
  { id: "3", project: "NWSL Creator Content Series", milestone: "Delivery", amount: 29100, status: "pending", date: "Apr 15, 2026" },
  { id: "4", project: "NWSL Creator Content Series", milestone: "Final", amount: 9700, status: "upcoming", date: "Jun 1, 2026" },
]

export default function PartnerPaymentsPage() {
  const isDemo = isDemoMode()
  const paymentHistory = isDemo ? demoPaymentHistory : []
  const [bankInfo, setBankInfo] = useState({
    bankName: "Chase Bank",
    accountType: "checking",
    routingNumber: "XXXXXXXXX",
    accountNumber: "XXXXXXXXXXXX",
    accountName: "Fieldhouse Films LLC",
  })
  
  const [rateInfo, setRateInfo] = useState({
    dayRate: "2500",
    projectMinimum: "5000",
    paymentTerms: "net_30",
  })
  
  const totalPaid = paymentHistory.filter(p => p.status === "paid").reduce((sum, p) => sum + p.amount, 0)
  const totalPending = paymentHistory.filter(p => p.status === "pending").reduce((sum, p) => sum + p.amount, 0)
  const totalUpcoming = paymentHistory.filter(p => p.status === "upcoming").reduce((sum, p) => sum + p.amount, 0)
  
  return (
    <PartnerLayout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h1 className="font-display font-bold text-3xl text-[#0C3535]">Payment Setup</h1>
          <p className="text-gray-600 mt-1">
            Manage your rates, payment preferences, and banking information.
          </p>
        </div>
        
        {/* Summary Cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-green-50 rounded-xl border border-green-200 p-5 text-center">
            <div className="font-display font-bold text-3xl text-green-600">
              ${totalPaid.toLocaleString()}
            </div>
            <div className="font-mono text-[10px] text-green-600 uppercase tracking-wider mt-1">
              Total Paid
            </div>
          </div>
          <div className="bg-yellow-50 rounded-xl border border-yellow-200 p-5 text-center">
            <div className="font-display font-bold text-3xl text-yellow-600">
              ${totalPending.toLocaleString()}
            </div>
            <div className="font-mono text-[10px] text-yellow-600 uppercase tracking-wider mt-1">
              Pending
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5 text-center">
            <div className="font-display font-bold text-3xl text-[#0C3535]">
              ${totalUpcoming.toLocaleString()}
            </div>
            <div className="font-mono text-[10px] text-gray-500 uppercase tracking-wider mt-1">
              Upcoming
            </div>
          </div>
        </div>
        
        {/* Rate Information */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-display font-bold text-lg text-[#0C3535] mb-6">Rate Information</h2>
          
          <div className="grid grid-cols-3 gap-6">
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Standard Day Rate
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                <Input
                  value={rateInfo.dayRate}
                  onChange={(e) => setRateInfo(prev => ({ ...prev, dayRate: e.target.value }))}
                  className="border-gray-200 pl-7 text-gray-900 placeholder:text-gray-500"
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">For reference only</p>
            </div>
            
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Project Minimum
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                <Input
                  value={rateInfo.projectMinimum}
                  onChange={(e) => setRateInfo(prev => ({ ...prev, projectMinimum: e.target.value }))}
                  className="border-gray-200 pl-7 text-gray-900 placeholder:text-gray-500"
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">Minimum project budget</p>
            </div>
            
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Preferred Payment Terms
              </label>
              <select
                value={rateInfo.paymentTerms}
                onChange={(e) => setRateInfo(prev => ({ ...prev, paymentTerms: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900"
              >
                <option value="net_15">Net 15</option>
                <option value="net_30">Net 30</option>
                <option value="net_45">Net 45</option>
                <option value="net_60">Net 60</option>
              </select>
            </div>
          </div>
          
          <div className="flex justify-end mt-6">
            <Button className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white">
              Save Rate Info
            </Button>
          </div>
        </div>
        
        {/* Banking Information */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="font-display font-bold text-lg text-[#0C3535]">Banking Information</h2>
              <p className="text-sm text-gray-600">Secure ACH transfer details for receiving payments.</p>
            </div>
            <span className="font-mono text-[10px] px-2 py-1 rounded-full bg-green-100 text-green-700">
              Verified
            </span>
          </div>
          
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Bank Name
              </label>
              <Input
                value={bankInfo.bankName}
                onChange={(e) => setBankInfo(prev => ({ ...prev, bankName: e.target.value }))}
                className="border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
            </div>
            
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Account Type
              </label>
              <select
                value={bankInfo.accountType}
                onChange={(e) => setBankInfo(prev => ({ ...prev, accountType: e.target.value }))}
                className="w-full h-10 px-3 rounded-md border border-gray-200 bg-white text-sm text-gray-900"
              >
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
              </select>
            </div>
            
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Routing Number
              </label>
              <Input
                value={bankInfo.routingNumber}
                onChange={(e) => setBankInfo(prev => ({ ...prev, routingNumber: e.target.value }))}
                className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                type="password"
              />
            </div>
            
            <div>
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Account Number
              </label>
              <Input
                value={bankInfo.accountNumber}
                onChange={(e) => setBankInfo(prev => ({ ...prev, accountNumber: e.target.value }))}
                className="border-gray-200 text-gray-900 placeholder:text-gray-500"
                type="password"
              />
            </div>
            
            <div className="col-span-2">
              <label className="block font-mono text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                Account Holder Name
              </label>
              <Input
                value={bankInfo.accountName}
                onChange={(e) => setBankInfo(prev => ({ ...prev, accountName: e.target.value }))}
                className="border-gray-200 text-gray-900 placeholder:text-gray-500"
              />
            </div>
          </div>
          
          <div className="flex justify-end mt-6">
            <Button className="bg-[#0C3535] hover:bg-[#0C3535]/90 text-white">
              Update Banking Info
            </Button>
          </div>
        </div>
        
        {/* Payment History */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="font-display font-bold text-lg text-[#0C3535] mb-6">Payment History</h2>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3">Project</th>
                  <th className="text-left font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3">Milestone</th>
                  <th className="text-right font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3">Amount</th>
                  <th className="text-right font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3">Date</th>
                  <th className="text-right font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3">Status</th>
                  <th className="text-right font-mono text-[10px] text-gray-500 uppercase tracking-wider py-3">Invoice</th>
                </tr>
              </thead>
              <tbody>
                {paymentHistory.map((payment) => (
                  <tr key={payment.id} className="border-b border-gray-100">
                    <td className="py-4 font-display font-bold text-sm text-[#0C3535]">{payment.project}</td>
                    <td className="py-4 text-sm text-gray-600">{payment.milestone}</td>
                    <td className="py-4 text-right font-mono text-sm text-[#0C3535]">${payment.amount.toLocaleString()}</td>
                    <td className="py-4 text-right font-mono text-xs text-gray-500">{payment.date}</td>
                    <td className="py-4 text-right">
                      <span className={cn(
                        "font-mono text-[10px] px-2 py-0.5 rounded-full capitalize",
                        payment.status === "paid" && "bg-green-100 text-green-700",
                        payment.status === "pending" && "bg-yellow-100 text-yellow-700",
                        payment.status === "upcoming" && "bg-gray-100 text-gray-600"
                      )}>
                        {payment.status}
                      </span>
                    </td>
                    <td className="py-4 text-right">
                      {payment.invoiceId ? (
                        <Button variant="ghost" size="sm" className="text-[#0C3535] hover:text-[#0C3535]/80">
                          {payment.invoiceId}
                        </Button>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PartnerLayout>
  )
}
