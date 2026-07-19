package com.pavavak.v3.ui

import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.pavavak.v3.R
import com.pavavak.v3.model.ThreadMessage
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class ThreadAdapter : RecyclerView.Adapter<ThreadAdapter.ThreadViewHolder>() {
    private val items = mutableListOf<ThreadMessage>()
    private val formatter = DateTimeFormatter.ofPattern("h:mm a").withZone(ZoneId.systemDefault())

    fun submitList(newItems: List<ThreadMessage>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }

    fun append(item: ThreadMessage) {
        if (items.any { it.messageId == item.messageId }) return
        items.add(item)
        notifyItemInserted(items.lastIndex)
    }

    fun updateStatus(messageId: String, status: String) {
        val index = items.indexOfFirst { it.messageId == messageId }
        if (index < 0) return
        items[index] = items[index].copy(status = status)
        notifyItemChanged(index)
    }

    fun markIncomingRead() {
        var changed = false
        for (index in items.indices) {
            if (items[index].direction == "incoming" && items[index].status != "read") {
                items[index] = items[index].copy(status = "read")
                changed = true
            }
        }
        if (changed) notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ThreadViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_message, parent, false)
        return ThreadViewHolder(view, formatter)
    }

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: ThreadViewHolder, position: Int) = holder.bind(items[position])

    class ThreadViewHolder(itemView: View, private val formatter: DateTimeFormatter) : RecyclerView.ViewHolder(itemView) {
        private val bubbleRoot = itemView.findViewById<View>(R.id.bubbleRoot)
        private val messageText = itemView.findViewById<TextView>(R.id.messageText)
        private val metaText = itemView.findViewById<TextView>(R.id.metaText)

        fun bind(item: ThreadMessage) {
            messageText.text = item.text
            metaText.text = "${formatTime(item.sentAt)}  ${item.status}"
            bubbleRoot.setBackgroundResource(
                if (item.direction == "outgoing") R.drawable.bg_bubble_out else R.drawable.bg_bubble_in
            )
            val params = bubbleRoot.layoutParams as FrameLayout.LayoutParams
            params.gravity = if (item.direction == "outgoing") Gravity.END else Gravity.START
            bubbleRoot.layoutParams = params
        }

        private fun formatTime(value: String): String {
            return runCatching {
                formatter.format(Instant.parse(value))
            }.getOrDefault(value)
        }
    }
}
