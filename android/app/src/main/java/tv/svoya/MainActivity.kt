package tv.svoya

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.*
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.PlaybackException
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import io.socket.client.IO
import io.socket.client.Socket
import org.json.JSONObject
import com.google.zxing.BarcodeFormat
import com.google.zxing.MultiFormatWriter
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private val bg = Color.rgb(16,17,25)
    private val surface = Color.rgb(30,31,44)
    private val lime = Color.rgb(213,255,112)
    private val lavender = Color.rgb(184,160,255)
    private val muted = Color.rgb(149,151,171)
    private val handler = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private var socket: Socket? = null
    private lateinit var root: LinearLayout
    private lateinit var player: ExoPlayer
    private lateinit var video: PlayerView
    private var state: JSONObject? = null
    private var timerText: TextView? = null
    private var offset = 0L
    private var prepared = ""
    private var lastPlay = ""
    private var server = ""
    private var key = ""
    private var generation = 0
    private var cachedFile: File? = null
    private var currentBitmap: Bitmap? = null
    private var readyId: String? = null
    private val prefs by lazy { getSharedPreferences("connection", MODE_PRIVATE) }
    private val ticker = object: Runnable {
        override fun run() {
            val deadline = state?.optLong("deadline", 0) ?: 0
            timerText?.text = if (deadline > 0) "${((deadline-System.currentTimeMillis()-offset+999)/1000).coerceAtLeast(0)} сек" else ""
            handler.postDelayed(this, 150)
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        player = ExoPlayer.Builder(this).build()
        video = PlayerView(this).apply { player=this@MainActivity.player; useController=false; isFocusable=false }
        player.addListener(object: Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                if(playbackState==Player.STATE_READY) acknowledge()
            }
            override fun onPlayerError(error: PlaybackException) { fail("Не удалось воспроизвести файл: ${error.errorCodeName}") }
        })
        server=prefs.getString("server", "") ?: ""
        key=prefs.getString("key", "") ?: ""
        handler.post(ticker)
        if(server.isNotBlank() && key.isNotBlank()) connect() else setup()
    }
    private fun dp(n: Int) = (n*resources.displayMetrics.density).toInt()
    private fun text(value: String,size: Float=20f,color:Int=Color.WHITE,bold:Boolean=false): TextView = TextView(this).apply {
        text=value;textSize=size;setTextColor(color); if(bold)typeface=Typeface.DEFAULT_BOLD
        setPadding(dp(8),dp(5),dp(8),dp(5))
    }
    private fun panel(color:Int=surface): GradientDrawable = GradientDrawable().apply {setColor(color);cornerRadius=dp(10).toFloat()}
    private fun newRoot(): LinearLayout {
        val r=LinearLayout(this).apply {orientation=LinearLayout.VERTICAL;setBackgroundColor(bg);setPadding(dp(36),dp(22),dp(36),dp(20))}
        val scroll=ScrollView(this).apply{isFillViewport=true;addView(r)}
        setContentView(scroll);root=r;return r
    }
    private fun setup(message:String="") {
        generation++;val previous=socket;socket=null;previous?.off();previous?.disconnect();player.pause();state=null;prepared="";lastPlay="";readyId=null
        newRoot();root.addView(text("СВОЯ ●",46f,lime,true));root.addView(text("Подключение большого экрана",24f,lavender))
        val address=EditText(this).apply {hint="http://192.168.1.100:3000";setText(server);setTextColor(Color.WHITE);inputType=android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI;isSingleLine=true}
        val secret=EditText(this).apply {hint="Ключ ТВ из пульта ведущего";setText(key);setTextColor(Color.WHITE);isSingleLine=true}
        root.addView(address);root.addView(secret)
        root.addView(Button(this).apply {text="Подключить экран";setOnClickListener {val a=address.text.toString().trim().trimEnd('/');val k=secret.text.toString().trim();if(!(a.startsWith("http://")||a.startsWith("https://"))||k.isBlank()){Toast.makeText(this@MainActivity,"Укажите полный адрес и ключ",Toast.LENGTH_LONG).show();return@setOnClickListener};server=a;key=k;prefs.edit().putString("server",server).putString("key",key).apply();connect()}})
        root.addView(text("Назад на пульте — вернуться к настройкам. Адрес должен быть доступен телевизору и телефонам.",15f,muted))
        if(message.isNotBlank())root.addView(text(message,18f,Color.rgb(255,170,180)))
        address.requestFocus()
    }
    private fun connect() {
        newRoot();root.addView(text("СВОЯ ●",46f,lime,true));root.addView(text("Подключаемся к эфиру…",24f))
        try {
            val options=IO.Options.builder().setAuth(mapOf("role" to "tv", "key" to key)).setReconnection(true).build()
            socket=IO.socket(server,options)
            socket?.on(Socket.EVENT_CONNECT){runOnUiThread { prepared="";readyId=null;lastPlay="" }}
            socket?.on("state"){args->runOnUiThread {try{val s=args[0] as JSONObject;offset=s.optLong("serverTime")-System.currentTimeMillis();state=s;prepareMedia();render();controlPlayback()}catch(e:Exception){fail("Ошибка экрана: ${e.message}")}}}
            socket?.on(Socket.EVENT_DISCONNECT){runOnUiThread{player.pause();newRoot();root.addView(text("Связь потеряна",38f,lavender,true));root.addView(text("Игра поставлена на паузу. Подключаемся заново…",22f));}}
            socket?.on(Socket.EVENT_CONNECT_ERROR){args->runOnUiThread{newRoot();root.addView(text("Нет подключения",36f,lavender,true));root.addView(text(args.firstOrNull()?.toString()?:"Проверьте адрес и ключ",18f));root.addView(text("Назад — изменить настройки",18f,muted));}}
            socket?.connect()
        } catch(e:Exception) {setup(e.message?:"Ошибка подключения")}
    }
    private fun acknowledge() {val id=state?.optJSONObject("current")?.optString("id");val stamp="$id:${state?.optInt("step")}";if(id!=null&&readyId!=stamp){readyId=stamp;socket?.emit("tv:ready",JSONObject().put("id",id).put("step",state?.optInt("step")?:0))}}
    private fun fail(message:String){player.pause();readyId=null;socket?.emit("tv:error",JSONObject().put("message",message));Toast.makeText(this,message,Toast.LENGTH_LONG).show()}
    private fun prepareMedia() {
        val s=state?:return;val q=s.optJSONObject("current");val signature=if(q==null)"none" else "${q.optString("id")}:${s.optInt("step")}:${q.optString("media")}" 
        if(signature==prepared)return
        prepared=signature;readyId=null;lastPlay="";player.stop();player.clearMediaItems();currentBitmap=null;cachedFile=null;val gen=++generation
        if(q==null)return
        val name=q.optString("media", "")
        if(name.isBlank()||name=="null"){acknowledge();return}
        worker.execute {
            try {
                val f=File(cacheDir,name)
                if(!f.exists()) {
                    val partial=File(cacheDir,"$name.part")
                    val conn=URL("$server/media/$name").openConnection() as HttpURLConnection
                    conn.setRequestProperty("X-TV-Key",key);conn.connectTimeout=15000;conn.readTimeout=30000
                    try {if(conn.responseCode!=200)throw Exception("HTTP ${conn.responseCode}");conn.inputStream.use{input->partial.outputStream().use{output->input.copyTo(output)}};if(!partial.renameTo(f))throw Exception("Не удалось сохранить медиа")}finally{conn.disconnect();partial.delete()}
                }
                // Keep the cache bounded; never delete the file being used.
                var total=cacheDir.listFiles()?.sumOf{it.length()}?:0L
                cacheDir.listFiles()?.filter{it!=f}?.sortedBy{it.lastModified()}?.forEach{if(total>600L*1024*1024){val n=it.length();if(it.delete())total-=n}}
                val bitmap=if(name.matches(Regex(".*\\.(jpg|png|webp)$"))) {val options=BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeFile(f.path,options);options.inJustDecodeBounds=false;options.inSampleSize=maxOf(1,options.outWidth/1920,options.outHeight/1080);BitmapFactory.decodeFile(f.path,options)?:throw Exception("Не удалось открыть изображение")} else null
                runOnUiThread {
                    if(gen!=generation)return@runOnUiThread
                    cachedFile=f;currentBitmap=bitmap
                    if(bitmap!=null){acknowledge();render()} else {
                        val builder=MediaItem.Builder().setUri(Uri.fromFile(f))
                        if(s.optString("mode")=="melody") {val start=(q.optDouble("start",0.0)*1000).toLong();val end=start+(q.optDouble("seconds",1.0)*1000).toLong();builder.setClippingConfiguration(MediaItem.ClippingConfiguration.Builder().setStartPositionMs(start).setEndPositionMs(end).build())}
                        player.setMediaItem(builder.build());player.prepare();render()
                    }
                }
            } catch(e:Exception){runOnUiThread{if(gen==generation)fail(e.message?:"Ошибка загрузки")}}
        }
    }
    private fun controlPlayback(){val s=state?:return;if(s.optString("phase")!="open"){player.pause();return};val play=s.optString("playId");if(play!=lastPlay){lastPlay=play;player.seekTo(0);player.play()}}
    private fun render() {
        val s=state?:return
        (video.parent as? ViewGroup)?.removeView(video)
        newRoot()
        val top=LinearLayout(this).apply {orientation=LinearLayout.HORIZONTAL;gravity=Gravity.CENTER_VERTICAL}
        top.addView(text("СВОЯ ●",26f,lime,true),LinearLayout.LayoutParams(0,-2,1f))
        top.addView(text(if(s.optString("mode")=="quiz")"СВОЯ ИГРА" else "УГАДАЙ МЕЛОДИЮ",14f,muted))
        timerText=text("",26f,lime,true);top.addView(timerText);root.addView(top)
        val phase=s.optString("phase");val q=s.optJSONObject("current")
        val players=s.optJSONArray("players")
        fun playerName(id:String):String {if(players!=null)for(i in 0 until players.length()){val p=players.getJSONObject(i);if(p.optString("id")==id)return p.optString("name")};return ""}
        when(phase){
            "lobby"->{
                val row=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL;gravity=Gravity.CENTER_VERTICAL;setPadding(0,dp(30),0,dp(30))}
                val words=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL}
                words.addView(text("Все свои.\nВсе в игре.",54f,Color.WHITE,true));words.addView(text("Сканируй QR-код и введи своё имя",20f,lavender));words.addView(text(server,16f,muted))
                row.addView(words,LinearLayout.LayoutParams(0,-2,1f))
                val matrix=MultiFormatWriter().encode(server,BarcodeFormat.QR_CODE,300,300)
                val bitmap=Bitmap.createBitmap(300,300,Bitmap.Config.RGB_565)
                for(x in 0..299)for(y in 0..299)bitmap.setPixel(x,y,if(matrix[x,y])bg else Color.WHITE)
                row.addView(ImageView(this).apply{setImageBitmap(bitmap)},LinearLayout.LayoutParams(dp(190),dp(190)));root.addView(row)
            }
            "board"->{
                root.addView(text("${s.optString("title")}  /  Выбор вопроса",21f,lavender,true))
                val used=s.optJSONArray("used")?.let{a->(0 until a.length()).map{a.optString(it)}}?:emptyList()
                if(s.optString("mode")=="quiz"){
                    val board=s.getJSONArray("board");val categories=linkedMapOf<String,MutableList<JSONObject>>()
                    for(i in 0 until board.length()){val a=board.getJSONObject(i);categories.getOrPut(a.getString("category")){mutableListOf()}.add(a)}
                    categories.forEach{(cat,list)->
                        val row=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL;setPadding(0,dp(4),0,dp(4))}
                        row.addView(text(cat,17f,lavender,true).apply{gravity=Gravity.CENTER_VERTICAL;background=panel()},LinearLayout.LayoutParams(dp(160),dp(64)))
                        list.sortedBy{it.optInt("value")}.forEach{a->row.addView(text(if(used.contains(a.optString("id")))"—" else a.optString("value"),28f,lime,true).apply{gravity=Gravity.CENTER;background=panel()},LinearLayout.LayoutParams(0,dp(64),1f).apply{leftMargin=dp(7)})}
                        root.addView(row)
                    }
                }else{
                    val tracks=s.getJSONArray("tracks");if(tracks.length()==0)root.addView(text("Добавьте песни в редакторе ведущего",25f,muted))
                    var row=LinearLayout(this)
                    for(i in 0 until tracks.length()){if(i%5==0){row=LinearLayout(this).apply{orientation=LinearLayout.HORIZONTAL};root.addView(row)};val t=tracks.getJSONObject(i);row.addView(text(if(used.contains(t.getString("id")))"✓ Сыгран" else "♫ ${t.getString("label")}",22f,lavender,true).apply{gravity=Gravity.CENTER;background=panel()},LinearLayout.LayoutParams(0,dp(78),1f).apply{setMargins(dp(3),dp(5),dp(3),dp(5))})}
                }
            }
            "finished"->root.addView(text("Аплодисменты\nпобедителям.",49f,lavender,true))
            else->{
                root.addView(text("${q?.optInt("value")?:0} БАЛЛОВ"+(if(s.optString("mode")=="melody")"  •  ФРАГМЕНТ ${s.optInt("step")+1}" else ""),16f,lime,true).apply{gravity=Gravity.CENTER})
                root.addView(text(q?.optString("text")?:"",34f,Color.WHITE,true).apply{gravity=Gravity.CENTER})
                if(currentBitmap!=null)root.addView(ImageView(this).apply{setImageBitmap(currentBitmap);adjustViewBounds=true},LinearLayout.LayoutParams(-1,dp(200)))
                else if(q?.optString("media")?.endsWith(".mp4")==true)root.addView(video,LinearLayout.LayoutParams(-1,dp(220)))
                else if(s.optString("mode")=="melody")root.addView(text(if(phase=="open")"♫   ♪   ♫   ♪   ♫" else "♫",52f,lavender).apply{gravity=Gravity.CENTER})
                if(phase=="revealed")root.addView(text(q?.optString("answer")?:"",30f,lime,true).apply{gravity=Gravity.CENTER})
                val prompt=when(phase){"open"->"Нажимай, если знаешь!";"answering"->"Отвечает ${playerName(s.optString("winner"))}";"paused"->"Пауза";"revealed"->"Правильный ответ";else->"Приготовьтесь"}
                root.addView(text(prompt,23f,lavender).apply{gravity=Gravity.CENTER})
            }
        }
        if(players!=null){val ranked=(0 until players.length()).map{players.getJSONObject(it)}.sortedByDescending{it.getJSONObject("scores").optInt(s.optString("mode"))};val line=ranked.joinToString("      "){"${it.optString("name")}  ${it.getJSONObject("scores").optInt(s.optString("mode"))}"};root.addView(text(line,if(phase=="finished")27f else 17f,lime,true).apply{gravity=Gravity.CENTER;setPadding(dp(10),dp(24),dp(10),dp(10))})}
    }
    @Deprecated("TV setup shortcut")
    override fun onBackPressed(){setup()}
    override fun onDestroy(){handler.removeCallbacks(ticker);socket?.disconnect();player.release();worker.shutdownNow();super.onDestroy()}
}
