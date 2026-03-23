"use client"

import { useState, useRef, useEffect } from "react"
import { Send, Bot, User, Loader2, FileText, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  sources?: {
    page?: number
    text: string
  }[]
}

// Mock initial messages
const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "1",
    role: "assistant",
    content: "I've analyzed the Sunset Gardens OM. What would you like to know about this deal?",
    timestamp: new Date(Date.now() - 1000 * 60 * 25)
  }
]

// Suggested questions
const SUGGESTED_QUESTIONS = [
  "What is the projected NOI in year 3?",
  "What are the major red flags in this deal?",
  "Compare this cap rate to market average",
  "What is the debt service coverage ratio?",
  "Summarize the value-add opportunities",
]

export function ChatInterface() {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES)
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const handleSend = async (question?: string) => {
    const messageText = question || input.trim()
    if (!messageText) return

    // Add user message
    const userMessage: ChatMessage = {
      id: Math.random().toString(36).substr(2, 9),
      role: "user",
      content: messageText,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInput("")
    setIsLoading(true)

    // Simulate AI response
    setTimeout(() => {
      let response: ChatMessage

      if (messageText.toLowerCase().includes("noi") || messageText.toLowerCase().includes("year 3")) {
        response = {
          id: Math.random().toString(36).substr(2, 9),
          role: "assistant",
          content: "Based on the pro forma, the projected NOI for Year 3 is $945,000. This represents a 8% increase from the Year 1 NOI of $875,000, driven primarily by:\n\n• Rent growth of 5% annually (vs 3.2% market)\n• Stabilized vacancy of 5% (vs current 3%)\n• Operating expense growth capped at 2.5% annually\n\nNote: The rent growth assumption is above the submarket average. I flagged this as a potential concern in the red flags section.",
          timestamp: new Date(),
          sources: [
            { page: 12, text: "Pro Forma Projections" },
            { page: 8, text: "Rent Roll Analysis" }
          ]
        }
      } else if (messageText.toLowerCase().includes("red flag")) {
        response = {
          id: Math.random().toString(36).substr(2, 9),
          role: "assistant",
          content: "I identified 4 key red flags in this deal:\n\n**1. Above-Market Rent Assumptions (Warning)**\nThe underwriter projects 5% annual rent growth, but the submarket average is 3.2%. This could lead to overestimation of future cash flows.\n\n**2. Deferred Maintenance Concern (Critical)**\nThe capex reserve of $300K appears insufficient for a 1985-built property. The property condition report mentions needed roof and HVAC work.\n\n**3. Late Payment History (Warning)**\n8 tenants show late payments in the past 6 months, which could indicate tenant quality issues.\n\n**4. Below-Market Vacancy (Info)**\nCurrent 3% vacancy is well below the 6.5% market average. While positive now, verify if this is sustainable or due to below-market rents.",
          timestamp: new Date(),
          sources: [
            { page: 15, text: "Red Flags Summary" },
            { page: 22, text: "Property Condition Report" }
          ]
        }
      } else if (messageText.toLowerCase().includes("cap rate")) {
        response = {
          id: Math.random().toString(36).substr(2, 9),
          role: "assistant",
          content: "The deal shows a 7.0% cap rate, which is favorable compared to the submarket average of 6.2%. This represents an 80 basis point premium.\n\n**Market Context:**\n• This submarket (East Hollywood): 6.2% avg\n• Class B properties: 6.5% avg\n• Comparable sales (6-mo): 6.0% - 6.8%\n\nThe higher cap rate may reflect:\n1. Property age (1985)\n2. Deferred maintenance needs\n3. Current value-add opportunity\n\nAt the asking price, this cap rate provides a margin of safety compared to recent trades.",
          timestamp: new Date(),
          sources: [
            { page: 5, text: "Executive Summary" },
            { page: 18, text: "Comparable Sales" }
          ]
        }
      } else {
        response = {
          id: Math.random().toString(36).substr(2, 9),
          role: "assistant",
          content: "I found relevant information in the document. Based on the analysis:\n\nThe Sunset Gardens property presents a solid investment opportunity with a 7.2/10 deal score. The 7.0% cap rate and 12.5% cash-on-cash return are attractive, though the aggressive rent growth assumptions warrant careful review during due diligence.\n\nWould you like me to dive deeper into any specific aspect of this deal?",
          timestamp: new Date(),
          sources: [
            { page: 1, text: "Executive Summary" }
          ]
        }
      }

      setMessages(prev => [...prev, response])
      setIsLoading(false)
    }, 1500)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-[500px]">
      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-2 scrollbar-thin">
        {messages.map((message) => (
          <div
            key={message.id}
            className={cn(
              "flex space-x-3",
              message.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            {message.role === "assistant" && (
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Bot className="h-4 w-4 text-primary" />
              </div>
            )}
            <div
              className={cn(
                "max-w-[80%] rounded-2xl px-4 py-3",
                message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-gray-100 text-gray-900"
              )}
            >
              <div className="text-sm whitespace-pre-line">
                {message.content}
              </div>
              {message.sources && message.sources.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200/50">
                  <p className="text-xs text-gray-500 mb-2 flex items-center">
                    <FileText className="h-3 w-3 mr-1" />
                    Sources:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {message.sources.map((source, idx) => (
                      <button
                        key={idx}
                        className="text-xs px-2 py-1 bg-white/50 hover:bg-white rounded-md transition-colors flex items-center space-x-1"
                        onClick={() => toast({
                          title: "View source",
                          description: `Opening page ${source.page}...`
                        })}
                      >
                        <span>p. {source.page}</span>
                        <ChevronRight className="h-3 w-3" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <p className={cn(
                "text-xs mt-2",
                message.role === "user" ? "text-primary-foreground/70" : "text-gray-500"
              )}>
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            {message.role === "user" && (
              <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                <User className="h-4 w-4 text-gray-600" />
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="flex space-x-3">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="bg-gray-100 rounded-2xl px-4 py-3 flex items-center space-x-2">
              <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
              <span className="text-sm text-gray-500">Analyzing document...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Suggested Questions */}
      {messages.length < 2 && (
        <div className="mt-4">
          <p className="text-xs text-gray-500 mb-2">Suggested questions:</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((question, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(question)}
                className="text-xs px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full transition-colors"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="mt-4 flex space-x-2">
        <div className="flex-1 relative">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about this document..."
            className="w-full px-4 py-3 pr-12 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
          />
        </div>
        <Button
          onClick={() => handleSend()}
          disabled={!input.trim() || isLoading}
          className="px-4 py-3 h-auto"
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Send className="h-5 w-5" />
          )}
        </Button>
      </div>
      <p className="text-xs text-gray-500 mt-2 text-center">
        AI responses are based on document analysis. Always verify critical information.
      </p>
    </div>
  )
}
