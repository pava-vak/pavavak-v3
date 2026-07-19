package com.pavavak.v3.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.pavavak.v3.R
import com.pavavak.v3.model.ChatListItem

class ChatListAdapter(private val onChatClick: (ChatListItem) -> Unit) : RecyclerView.Adapter<ChatListAdapter.ChatViewHolder>() {
    private val items = mutableListOf<ChatListItem>()

    fun submitList(newItems: List<ChatListItem>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ChatViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_chat, parent, false)
        return ChatViewHolder(view)
    }

    override fun getItemCount(): Int = items.size

    override fun onBindViewHolder(holder: ChatViewHolder, position: Int) = holder.bind(items[position])

    inner class ChatViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val avatarText = itemView.findViewById<TextView>(R.id.avatarText)
        private val titleText = itemView.findViewById<TextView>(R.id.titleText)
        private val subtitleText = itemView.findViewById<TextView>(R.id.subtitleText)
        private val previewText = itemView.findViewById<TextView>(R.id.previewText)
        private val unreadText = itemView.findViewById<TextView>(R.id.unreadText)

        fun bind(item: ChatListItem) {
            avatarText.text = item.avatarText
            titleText.text = item.title
            subtitleText.text = item.subtitle
            previewText.text = item.lastMessage?.text ?: "No messages yet"
            unreadText.visibility = if (item.unreadCount > 0) View.VISIBLE else View.GONE
            unreadText.text = item.unreadCount.toString()
            itemView.setOnClickListener { onChatClick(item) }
        }
    }
}