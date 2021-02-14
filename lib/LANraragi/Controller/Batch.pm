package LANraragi::Controller::Batch;
use Mojo::Base 'Mojolicious::Controller';

use Redis;
use Encode;
use Mojo::IOLoop::Subprocess;
use Mojo::Util qw(xml_escape);
use Mojo::JSON qw(decode_json encode_json from_json);

use LANraragi::Utils::Generic qw(generate_themes_selector generate_themes_header);
use LANraragi::Utils::Database qw(redis_decode);
use LANraragi::Utils::Plugins qw(get_plugins get_plugin get_plugin_parameters);
use LANraragi::Utils::Logging qw(get_logger);

# This action will render a template
sub index {
    my $self  = shift;
    my $redis = $self->LRR_CONF->get_redis();

    #Then complete it with the rest from the database.
    #40-character long keys only => Archive IDs
    my @keys = $redis->keys('????????????????????????????????????????');

    #Parse the archive list and build <li> elements accordingly.
    my $arclist = "";

    #Only show IDs that still have their files present.
    foreach my $id (@keys) {
        my $zipfile = $redis->hget( $id, "file" );
        my $title   = $redis->hget( $id, "title" );
        $title = redis_decode($title);
        $title = xml_escape($title);

        if ( -e $zipfile ) {
            $arclist .= "<li><input type='checkbox' name='archive' id='$id' class='archive' >";
            $arclist .= "<label for='$id'> $title</label></li>";
        }
    }

    $redis->quit();

    #Build plugin listing
    my @pluginlist = get_plugins("metadata");

    $self->render(
        template => "batch",
        arclist  => $arclist,
        plugins  => \@pluginlist,
        title    => $self->LRR_CONF->get_htmltitle,
        cssdrop  => generate_themes_selector,
        csshead  => generate_themes_header($self),
        version  => $self->LRR_VERSION
    );
}

#Websocket server receiving a list of IDs as a JSON and calling the specified plugin on them.
sub socket {

    my $self      = shift;
    my $cancelled = 0;
    my $client    = $self->tx;
    my $redis     = $self->LRR_CONF->get_redis();

    my $logger = get_logger( "Batch Tagging", "lanraragi" );

    $logger->info('客户端连接到批量标签服务');

    # Increase inactivity timeout for connection a bit to account for clientside timeouts
    $self->inactivity_timeout(80);

    $self->on(
        message => sub {
            my ( $self, $msg ) = @_;

            #JSON-decode message and grab the plugin
            my $command    = decode_json($msg);
            my $pluginname = $command->{"plugin"};

            my $plugin = get_plugin($pluginname);

            #Global arguments can come from the database or the user override
            my @args    = @{ $command->{"args"} };
            my $timeout = $command->{"timeout"} || 0;

            if ($plugin) {

                #If the array is empty(no overrides)
                if ( !@args ) {
                    $logger->debug("未给出用户覆盖。");

                    # Try getting the saved defaults
                    @args = get_plugin_parameters($pluginname);
                }

                # Run plugin with args on id
                my $id = $command->{"archive"};
                unless ($id) {
                    $client->finish( 1001 => '没有提供档案。' );
                    return;
                }
                $logger->debug("处理 $id");

                my %plugin_result;
                eval { %plugin_result = LANraragi::Model::Plugins::exec_metadata_plugin( $plugin, $id, "", @args ); };

                if ($@) {
                    $plugin_result{error} = $@;
                }

                #If the plugin exec returned tags, add them
                unless ( exists $plugin_result{error} ) {
                    LANraragi::Utils::Database::add_tags( $id, $plugin_result{new_tags} );

                    if ( exists $plugin_result{title} ) {
                        LANraragi::Utils::Database::set_title( $id, $plugin_result{title} );
                    }
                }

                # Send reply message for completed archive
                $client->send(
                    {   json => {
                            id      => $id,
                            success => exists $plugin_result{error} ? 0 : 1,
                            message => $plugin_result{error},
                            tags    => $plugin_result{new_tags},
                            title   => exists $plugin_result{title} ? $plugin_result{title} : ""
                        }
                    }
                );
            } else {
                $client->finish( 1001 => '插件不存在' );
            }
        }
    );

    $self->on(

        #If the client doesn't respond, halt processing
        finish => sub {
            $logger->info('客户端断开连接，停止其余操作。');
            $cancelled = 1;
            $redis->quit();
        }
    );

}

1;
