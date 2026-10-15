-- Sends one plain-text email through Mail.app from the owner's own account.
-- Values arrive as arguments (argv), never spliced into this script, so no text can change what it does.
on run argv
	set theTo to item 1 of argv
	set theSubject to item 2 of argv
	set theBody to item 3 of argv
	tell application "Mail"
		set m to make new outgoing message with properties {subject:theSubject, content:theBody, visible:false}
		if (count of argv) > 3 then set sender of m to item 4 of argv
		tell m to make new to recipient at end of to recipients with properties {address:theTo}
		send m
	end tell
end run
